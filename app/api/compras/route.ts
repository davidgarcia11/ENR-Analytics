import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { parseJdeDate, getDayOfYear } from '@/lib/utils';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';

// ponytail: tipo de coste vigente en F4105 (COLEDG). JDE lo cambia cada año (P6=2026)
// y no hay un patrón año->código confirmado. Actualizar a mano cada enero.
// Ver docs/compras.md.
const COLEDG_VIGENTE = 'P6';

const PLANTA_PRESUPUESTOS = 10999;
const TIPO_DOC_EXCLUIDO = 'ST'; // F4211.SDDCTO — excluido de "venta real" a petición del usuario

function jdeBoundsFromDates(startDateStr: string, endDateStr: string) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const startJde = 100000 + (start.getFullYear() - 2000) * 1000 + getDayOfYear(start);
    const endJde = 100000 + (end.getFullYear() - 2000) * 1000 + getDayOfYear(end);
    return { startJde, endJde };
}

function monthKey(item: string, date: Date) {
    return `${item}|${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

interface Bucket {
    item: string;
    anio: number;
    mes: number;
    prevQtyRaw: number;
    hasPrevisto: boolean;
    realImporte: number;
    realQty: number;
    hasReal: boolean;
}

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('compras');
    if (denied) return denied;
    const startTime = Date.now();

    const { searchParams } = new URL(req.url);
    const items = searchParams.getAll('item');
    const marcas = searchParams.getAll('marca'); // Filtro por Marca (IMSRP4 de F4101, ver /api/categories?field=srp4)
    const now = new Date();
    // Default "este mes", no el año — sin filtro SDNXTR el año completo escanea ~165.000 líneas
    // de F4211 y tarda ~2,5min (ver docs/compras.md §3.3/§11). El mes es rápido.
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
    const startDateStr = searchParams.get('startDate') || monthStart;
    const endDateStr = searchParams.get('endDate') || monthEndStr;
    const { startJde, endJde } = jdeBoundsFromDates(startDateStr, endDateStr);

    let conn;
    try {
        conn = await getDbConnection();

        const itemBinds: any = {};
        items.forEach((it, i) => { itemBinds[`item${i}`] = it; });
        const itemPlaceholders = items.map((_, i) => `:item${i}`).join(', ');

        // A) Previsión de ventas (F3460) — un valor por artículo y mes.
        // MFLITM = artículo largo/visible (clave de agrupación, comparable a SDAITM de F4211).
        // MFITM  = artículo corto, solo para cruzar F4101 (descripción/familia).
        const forecastSql = `
            SELECT TRIM(MFLITM) AS ITEM, TRIM(MFITM) AS ITEM_CORTO, MFDRQJ AS FECHA_JDE, MFFQT AS CANT_PREV_RAW
            FROM F3460
            WHERE MFMCU = :planta AND MFDRQJ BETWEEN :startJde AND :endJde
            ${items.length ? `AND TRIM(MFLITM) IN (${itemPlaceholders})` : ''}
        `;
        // B) Coste unitario vigente (F4105) — no tiene granularidad mensual.
        // COLITM es el artículo largo (mismo espacio que MFLITM/SDAITM), no requiere traducción a corto.
        const costSql = `
            SELECT TRIM(COLITM) AS ITEM, COUNCS AS COSTE_RAW
            FROM F4105
            WHERE COMCU = :planta AND COLEDG = :coledg
            ${items.length ? `AND TRIM(COLITM) IN (${itemPlaceholders})` : ''}
        `;
        // C) Venta real (F4211) — excluye tipo de documento SDDCTO='ST' y líneas sin fecha de
        // envío (SDADDJ!=0), fecha de envío real (SDADDJ), no fecha de pedido. SDAITM = artículo
        // largo/visible (clave de agrupación). SDITM = artículo corto para F4101 (mismo patrón
        // que app/api/orders/route.ts: `LEFT JOIN F4101 E ON E.IMITM = A.SDITM`).
        // ojo: SIN filtro SDNXTR!=999 — ese filtro es propio de /preparacion-pedidos (pedidos
        // pendientes, excluye cerrados/históricos) y aquí excluía casi todo el histórico real.
        const salesSql = `
            SELECT TRIM(A.SDAITM) AS ITEM, TRIM(A.SDITM) AS ITEM_CORTO, A.SDADDJ AS FECHA_JDE,
                   A.SDUORG AS CANT_REAL_RAW, A.SDUPRC AS PRECIO_RAW
            FROM F4211 A
            WHERE TRIM(A.SDDCTO) != :tipoDocExcluido AND A.SDADDJ != 0
                AND A.SDADDJ BETWEEN :startJde AND :endJde
            ${items.length ? `AND TRIM(A.SDAITM) IN (${itemPlaceholders})` : ''}
        `;

        const [forecastResult, costResult, salesResult] = await Promise.all([
            conn.execute(forecastSql, { planta: PLANTA_PRESUPUESTOS, startJde, endJde, ...itemBinds }),
            conn.execute(costSql, { planta: PLANTA_PRESUPUESTOS, coledg: COLEDG_VIGENTE, ...itemBinds }),
            conn.execute(salesSql, { tipoDocExcluido: TIPO_DOC_EXCLUIDO, startJde, endJde, ...itemBinds }),
        ]);

        const forecastRows = forecastResult.rows as any[];
        const costRows = costResult.rows as any[];
        const salesRows = salesResult.rows as any[];

        // Coste unitario previsto por artículo (foto actual, sin fecha)
        const costMap = new Map<string, number>();
        costRows.forEach(r => {
            const item = String(r.ITEM).trim();
            if (!costMap.has(item)) costMap.set(item, (r.COSTE_RAW || 0) / 10000);
            else console.warn(`F4105: coste duplicado para item ${item} (COLEDG=${COLEDG_VIGENTE}), se usa el primero`);
        });

        // Mapa artículo largo -> artículo corto (para cruzar F4101, que se indexa por el corto)
        const shortItemMap = new Map<string, string>();
        forecastRows.forEach(r => {
            const item = String(r.ITEM).trim();
            const corto = String(r.ITEM_CORTO || '').trim();
            if (item && corto && !shortItemMap.has(item)) shortItemMap.set(item, corto);
        });
        salesRows.forEach(r => {
            const item = String(r.ITEM).trim();
            const corto = String(r.ITEM_CORTO || '').trim();
            if (item && corto && !shortItemMap.has(item)) shortItemMap.set(item, corto);
        });

        // Set de artículos cortos encontrados en previsión o venta real (F4101 se indexa por el corto)
        const itemIds = Array.from(new Set(Array.from(shortItemMap.values()))).filter(Boolean);

        if (itemIds.length === 0) {
            return NextResponse.json({
                filters: { startDate: startDateStr, endDate: endDateStr, items, marcas },
                rows: [],
                resumen: emptyResumen(),
            });
        }

        const idBinds: any = {};
        itemIds.forEach((id, i) => { idBinds[`id${i}`] = id; });
        const idPlaceholders = itemIds.map((_, i) => `:id${i}`).join(', ');

        // D) Metadata de artículo (descripción/familia/marca, para mostrar y filtrar en la tabla)
        const metaSql = `SELECT TRIM(IMITM) AS ITEM, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA, TRIM(IMSRP4) AS MARCA FROM F4101 WHERE IMITM IN (${idPlaceholders})`;
        // E) Gramaje (F554101.AAZE03 = gramos por unidad, directo, sin pasar por la descripción
        // de prodctl.f0005) — mismo patrón de artículo corto que usa /produccion para el filtro
        // de gramaje (AAITM = IMITM).
        const gramajeSql = `SELECT TRIM(AAITM) AS ITEM, TRIM(AAZE03) AS GRAMOS_RAW FROM F554101 WHERE AAITM IN (${idPlaceholders})`;

        const [metaResult, gramajeResult] = await Promise.all([
            conn.execute(metaSql, idBinds),
            conn.execute(gramajeSql, idBinds),
        ]);

        const metaMap = new Map<string, { descripcion: string; familia: string; marca: string }>();
        (metaResult.rows as any[]).forEach(r => {
            metaMap.set(String(r.ITEM).trim(), {
                descripcion: String(r.DESCRIPCION || '').trim(),
                familia: String(r.FAMILIA || '').trim(),
                marca: String(r.MARCA || '').trim(),
            });
        });

        // Gramaje: AAZE03 es directamente el nº de gramos por unidad (confirmado por el usuario,
        // no requiere parsear la descripción de prodctl.f0005).
        const gramajeMap = new Map<string, number>();
        (gramajeResult.rows as any[]).forEach(r => {
            const gramos = Number(String(r.GRAMOS_RAW || '').trim());
            if (!Number.isNaN(gramos) && gramos > 0) gramajeMap.set(String(r.ITEM).trim(), gramos);
        });

        // Acumulador por artículo+mes
        const buckets = new Map<string, Bucket>();
        const getBucket = (item: string, date: Date): Bucket => {
            const key = monthKey(item, date);
            let b = buckets.get(key);
            if (!b) {
                b = { item, anio: date.getFullYear(), mes: date.getMonth() + 1, prevQtyRaw: 0, hasPrevisto: false, realImporte: 0, realQty: 0, hasReal: false };
                buckets.set(key, b);
            }
            return b;
        };

        forecastRows.forEach(r => {
            const item = String(r.ITEM).trim();
            const parsed = parseJdeDate(r.FECHA_JDE);
            if (!parsed) return;
            const b = getBucket(item, parsed.date);
            b.prevQtyRaw += (r.CANT_PREV_RAW || 0);
            b.hasPrevisto = true;
        });

        salesRows.forEach(r => {
            const item = String(r.ITEM).trim();
            const parsed = parseJdeDate(r.FECHA_JDE);
            if (!parsed) return;
            const b = getBucket(item, parsed.date);
            const qtyLinea = (r.CANT_REAL_RAW || 0) / 100;
            const precioLinea = (r.PRECIO_RAW || 0) / 10000;
            b.realImporte += qtyLinea * precioLinea;
            b.realQty += qtyLinea;
            b.hasReal = true;
        });

        const rows = Array.from(buckets.values()).map(b => {
            const itemCorto = shortItemMap.get(b.item) || '';
            const meta = metaMap.get(itemCorto);
            // El coste (F4105) es una foto por artículo sin mes propio: si este mes no hay
            // previsión (F3460), tampoco mostramos precio previsto, para no contradecir el aviso.
            const costeUnitarioPrevisto = b.hasPrevisto ? (costMap.get(b.item) ?? null) : null;
            const qtyPrevisto = b.hasPrevisto ? b.prevQtyRaw / 100 : null;
            const importePrevisto = (qtyPrevisto != null && costeUnitarioPrevisto != null) ? qtyPrevisto * costeUnitarioPrevisto : null;

            const qtyReal = b.hasReal ? b.realQty : null;
            const importeReal = b.hasReal ? b.realImporte : null;
            const precioMedioReal = (qtyReal != null && qtyReal > 0) ? b.realImporte / qtyReal : null;

            // Kg por gramaje (F554101.AAZE03, gramos/unidad) — no por conversión de UM.
            // Mismo gramaje para previsto y real: es una propiedad del artículo, no de la transacción.
            const gramosPorUnidad = gramajeMap.get(itemCorto) ?? null;
            const kgPrevisto = (qtyPrevisto != null && gramosPorUnidad != null) ? qtyPrevisto * (gramosPorUnidad / 1000) : null;
            const kgReal = (qtyReal != null && gramosPorUnidad != null) ? qtyReal * (gramosPorUnidad / 1000) : null;

            const desviacionImporte = (importeReal != null && importePrevisto != null) ? importeReal - importePrevisto : null;
            const desviacionImportePct = (importePrevisto != null && importePrevisto !== 0 && desviacionImporte != null) ? (desviacionImporte / importePrevisto) * 100 : null;

            const desviacionPrecio = (precioMedioReal != null && costeUnitarioPrevisto != null) ? precioMedioReal - costeUnitarioPrevisto : null;
            const desviacionPrecioPct = (costeUnitarioPrevisto != null && costeUnitarioPrevisto !== 0 && desviacionPrecio != null) ? (desviacionPrecio / costeUnitarioPrevisto) * 100 : null;

            const desviacionCantidad = (qtyReal != null && qtyPrevisto != null) ? qtyReal - qtyPrevisto : null;
            const desviacionCantidadPct = (qtyPrevisto != null && qtyPrevisto !== 0 && desviacionCantidad != null) ? (desviacionCantidad / qtyPrevisto) * 100 : null;

            const desviacionKg = (kgReal != null && kgPrevisto != null) ? kgReal - kgPrevisto : null;
            const desviacionKgPct = (kgPrevisto != null && kgPrevisto !== 0 && desviacionKg != null) ? (desviacionKg / kgPrevisto) * 100 : null;

            const avisos: string[] = [];
            if (!b.hasPrevisto) avisos.push('Sin previsión este mes');
            if (!b.hasReal) avisos.push('Sin venta este mes');
            if (b.hasPrevisto && costeUnitarioPrevisto == null) avisos.push('Sin coste F4105');
            if ((b.hasPrevisto || b.hasReal) && gramosPorUnidad == null) avisos.push('Sin gramaje (F554101)');

            return {
                item: b.item,
                descripcion: meta?.descripcion || '',
                familia: meta?.familia || '',
                marca: meta?.marca || '',
                anio: b.anio,
                mes: b.mes,
                mesLabel: `${b.anio}-${String(b.mes).padStart(2, '0')}`,
                gramaje: gramosPorUnidad,
                previsto: { cantidad: qtyPrevisto, precioUnitario: costeUnitarioPrevisto, importe: importePrevisto, kg: kgPrevisto },
                real: { cantidad: qtyReal, precioUnitario: precioMedioReal, importe: importeReal, kg: kgReal },
                desviacion: {
                    cantidad: { abs: desviacionCantidad, pct: desviacionCantidadPct },
                    importe: { abs: desviacionImporte, pct: desviacionImportePct },
                    precio: { abs: desviacionPrecio, pct: desviacionPrecioPct },
                    kg: { abs: desviacionKg, pct: desviacionKgPct },
                },
                avisos,
            };
        }).sort((a, b) => a.mesLabel === b.mesLabel ? a.item.localeCompare(b.item) : a.mesLabel.localeCompare(b.mesLabel));

        // Marca (IMSRP4) solo se conoce tras cruzar con F4101, igual que familia — se filtra aquí
        // sobre las filas ya construidas, no en las queries a F3460/F4211/F4105.
        const rowsFiltradas = marcas.length > 0 ? rows.filter(r => marcas.includes(r.marca)) : rows;

        const resumen = buildResumen(rowsFiltradas);
        // Artículos (distintos) sin gramaje en F554101, para que se puedan revisar de un vistazo
        // en vez de tener que pasar el ratón fila a fila por el aviso.
        resumen.articulosSinGramaje = Array.from(new Set(rowsFiltradas.filter(r => r.gramaje == null).map(r => r.item))).sort();

        // Registrar consulta en logs (nunca bloquea la respuesta)
        try {
            const user = await verifySession().catch(() => null);
            const filters = { startDate: startDateStr, endDate: endDateStr, items, marcas };
            const db = getDb();
            db.prepare(
                'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(user?.id ?? null, user ? user.username : 'Invitado', 'compras', JSON.stringify(filters), rowsFiltradas.length, Date.now() - startTime);
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        return NextResponse.json({ filters: { startDate: startDateStr, endDate: endDateStr, items, marcas }, rows: rowsFiltradas, resumen });
    } catch (err: any) {
        console.error('Database Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}

function emptyResumen() {
    return {
        totalCantidadPrevisto: 0, totalCantidadReal: 0, desviacionCantidadPct: null,
        totalKgPrevisto: 0, totalKgReal: 0, desviacionKgPct: null,
        totalImportePrevisto: 0, totalImporteReal: 0, desviacionImportePct: null,
        precioMedioPrevisto: null, precioMedioReal: null, desviacionPrecioPct: null,
        porMes: [] as any[],
        articulosSinGramaje: [] as string[],
    };
}

function buildResumen(rows: any[]) {
    let totalImportePrevisto = 0, totalImporteReal = 0, totalCantidadPrevisto = 0, totalCantidadReal = 0;
    let totalKgPrevisto = 0, totalKgReal = 0;
    const porMesMap = new Map<string, { mesLabel: string; importePrevisto: number; importeReal: number; cantidadPrevisto: number; cantidadReal: number; kgPrevisto: number; kgReal: number }>();

    rows.forEach(r => {
        if (r.previsto.importe != null) totalImportePrevisto += r.previsto.importe;
        if (r.real.importe != null) totalImporteReal += r.real.importe;
        if (r.previsto.cantidad != null) totalCantidadPrevisto += r.previsto.cantidad;
        if (r.real.cantidad != null) totalCantidadReal += r.real.cantidad;
        if (r.previsto.kg != null) totalKgPrevisto += r.previsto.kg;
        if (r.real.kg != null) totalKgReal += r.real.kg;

        let m = porMesMap.get(r.mesLabel);
        if (!m) { m = { mesLabel: r.mesLabel, importePrevisto: 0, importeReal: 0, cantidadPrevisto: 0, cantidadReal: 0, kgPrevisto: 0, kgReal: 0 }; porMesMap.set(r.mesLabel, m); }
        if (r.previsto.importe != null) m.importePrevisto += r.previsto.importe;
        if (r.real.importe != null) m.importeReal += r.real.importe;
        if (r.previsto.cantidad != null) m.cantidadPrevisto += r.previsto.cantidad;
        if (r.real.cantidad != null) m.cantidadReal += r.real.cantidad;
        if (r.previsto.kg != null) m.kgPrevisto += r.previsto.kg;
        if (r.real.kg != null) m.kgReal += r.real.kg;
    });

    const desviacionCantidadPct = totalCantidadPrevisto !== 0 ? ((totalCantidadReal - totalCantidadPrevisto) / totalCantidadPrevisto) * 100 : null;
    const desviacionKgPct = totalKgPrevisto !== 0 ? ((totalKgReal - totalKgPrevisto) / totalKgPrevisto) * 100 : null;
    const desviacionImportePct = totalImportePrevisto !== 0 ? ((totalImporteReal - totalImportePrevisto) / totalImportePrevisto) * 100 : null;
    const precioMedioPrevisto = totalCantidadPrevisto > 0 ? totalImportePrevisto / totalCantidadPrevisto : null;
    const precioMedioReal = totalCantidadReal > 0 ? totalImporteReal / totalCantidadReal : null;
    const desviacionPrecioPct = (precioMedioPrevisto != null && precioMedioReal != null && precioMedioPrevisto !== 0)
        ? ((precioMedioReal - precioMedioPrevisto) / precioMedioPrevisto) * 100 : null;

    const porMes = Array.from(porMesMap.values())
        .sort((a, b) => a.mesLabel.localeCompare(b.mesLabel))
        .map(m => ({
            ...m,
            precioPrevisto: m.cantidadPrevisto > 0 ? m.importePrevisto / m.cantidadPrevisto : null,
            precioReal: m.cantidadReal > 0 ? m.importeReal / m.cantidadReal : null,
        }));

    return {
        totalCantidadPrevisto, totalCantidadReal, desviacionCantidadPct,
        totalKgPrevisto, totalKgReal, desviacionKgPct,
        totalImportePrevisto, totalImporteReal, desviacionImportePct,
        precioMedioPrevisto, precioMedioReal, desviacionPrecioPct,
        porMes,
        articulosSinGramaje: [] as string[],
    };
}
