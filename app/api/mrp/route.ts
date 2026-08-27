// Explosión de compras (MRP): a partir de la previsión de venta (F3460, planta
// 10999) y la lista de materiales (F3002, planta 10999), calcula cuánto hay que
// comprar de cada material final.
//
// Lógica confirmada con el usuario y validada contra un ejemplo real (ver ClickUp
// #869eq7nqd):
// - El "tipo" de un artículo es el prefijo de 2 dígitos de su código largo
//   (IXKITL/IXLITM): 10, 11 y 12 son intermedios (hay que buscar SU lista de
//   materiales también, recursivo); cualquier otro prefijo es material final.
// - IXQNTY se divide entre 10000 (no ×100 como la mayoría de cantidades JDE).
// - La cantidad final se acumula en CASCADA: factor = ratio_nivel1 × ratio_nivel2
//   × ... × ratio_nivelN, multiplicado por la previsión del artículo padre inicial.
// - La vigencia de la línea de BOM (IXEFFF/IXEFFT) se evalúa contra la FECHA DE LA
//   PREVISIÓN (mes a mes), no contra "hoy" — si la previsión es de enero, se usa
//   la lista de materiales vigente en enero, aunque hoy ya no lo esté.
// No está en lib/panels.ts/`screens` todavía (panel en construcción) — acceso
// restringido a admin a mano, igual que produccion-v2.
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { parseJdeDate, getDayOfYear } from '@/lib/utils';
import { verifySession } from '@/lib/auth';

const PLANTA = 10999;
const TIPOS_INTERMEDIOS = new Set(['10', '11', '12']);
const MES_LABEL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function jdeBoundsFromDates(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const startJde = 100000 + (start.getFullYear() - 2000) * 1000 + getDayOfYear(start);
  const endJde = 100000 + (end.getFullYear() - 2000) * 1000 + getDayOfYear(end);
  return { startJde, endJde };
}

interface ForecastRow { ITEM: string; ITEM_CORTO: string; FECHA_JDE: number; CANT_PREV_RAW: number }
interface BomLine { componente: string; itemCortoComponente: number; qty: number; um: string }
interface BomRow { K: string; L: string; ITM_L: number; QTY: number; UM: string }
interface MetaRow { ITEM: string; DESCRIPCION: string; FAMILIA: string }

interface ForecastBucket {
  item: string; // código largo del artículo padre (MFLITM, = IXKITL)
  itemCorto: string;
  sortKey: string; // 'YYYY-MM'
  mesLabel: string;
  fechaJde: number; // última fecha JDE del mes — referencia de vigencia del BOM
  qty: number; // previsión total del mes
}

interface Contribucion { root: string; rootCorto: string; sortKey: string; mesLabel: string; qty: number }
interface MaterialAgg {
  itemCorto: number;
  um: string;
  total: number;
  contribuciones: Map<string, Contribucion>; // clave: root::sortKey
}

export async function GET(req: NextRequest) {
  // Gate manual de admin: panel sin registrar todavía en lib/panels.ts/`screens`
  // (no hay requireScreenAccess que aplicar a un panel que no existe ahí).
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthEndStr = `${monthEndDate.getFullYear()}-${String(monthEndDate.getMonth() + 1).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;
  const startDateStr = searchParams.get('startDate') || monthStart;
  const endDateStr = searchParams.get('endDate') || monthEndStr;
  const { startJde, endJde } = jdeBoundsFromDates(startDateStr, endDateStr);

  // Artículos padre (código largo) — opcional, para acotar a unos pocos productos.
  const parentFilter = searchParams.getAll('parentArticle').filter((v) => /^\d{10}$/.test(v));

  let conn;
  try {
    conn = await getDbConnection();

    // A) Previsión (F3460) — mismo patrón que /api/compras.
    const parentPlaceholders = parentFilter.map((_, i) => `:p${i}`).join(', ');
    const forecastSql = `
      SELECT TRIM(MFLITM) AS ITEM, TRIM(MFITM) AS ITEM_CORTO, MFDRQJ AS FECHA_JDE, MFFQT AS CANT_PREV_RAW
      FROM F3460
      WHERE MFMCU = :planta AND MFDRQJ BETWEEN :startJde AND :endJde
      ${parentFilter.length > 0 ? `AND TRIM(MFLITM) IN (${parentPlaceholders})` : ''}
    `;
    const forecastBinds: Record<string, string | number> = { planta: PLANTA, startJde, endJde };
    parentFilter.forEach((v, i) => { forecastBinds[`p${i}`] = v; });

    const forecastResult = await conn.execute(forecastSql, forecastBinds);
    const forecastRows = forecastResult.rows as ForecastRow[];

    // Artículo × mes -> previsión acumulada + fecha JDE de referencia (la más tardía
    // del mes: "31/01 = previsión de enero completa", vigencia del BOM en esa fecha).
    const bucketMap = new Map<string, ForecastBucket>();
    for (const r of forecastRows) {
      const item = String(r.ITEM).trim();
      const parsed = parseJdeDate(r.FECHA_JDE);
      if (!parsed) continue;
      const sortKey = `${parsed.date.getFullYear()}-${String(parsed.date.getMonth() + 1).padStart(2, '0')}`;
      const key = `${item}::${sortKey}`;
      const qty = (r.CANT_PREV_RAW || 0) / 100;
      const existing = bucketMap.get(key);
      if (existing) {
        existing.qty += qty;
        existing.fechaJde = Math.max(existing.fechaJde, r.FECHA_JDE);
      } else {
        bucketMap.set(key, {
          item,
          itemCorto: String(r.ITEM_CORTO).trim(),
          sortKey,
          mesLabel: `${MES_LABEL[parsed.date.getMonth()]} ${parsed.date.getFullYear()}`,
          fechaJde: r.FECHA_JDE,
          qty,
        });
      }
    }
    const buckets = Array.from(bucketMap.values()).filter((b) => b.qty > 0);

    if (buckets.length === 0) {
      return NextResponse.json({
        materiales: [],
        meta: { articulosPrevistos: 0, meses: [] as string[] },
      });
    }

    // B) BOM (F3002) — una consulta por cada fecha de referencia distinta (normalmente
    // una por mes de previsión), vigente EN ESA FECHA — no en la de hoy.
    const fechasDistintas = Array.from(new Set(buckets.map((b) => b.fechaJde)));
    const bomPorFecha = new Map<number, Map<string, BomLine[]>>();
    for (const fecha of fechasDistintas) {
      const bomSql = `
        SELECT TRIM(IXKITL) K, TRIM(IXLITM) L, IXITM ITM_L, IXQNTY QTY, TRIM(IXUM) UM
        FROM F3002
        WHERE TRIM(IXCMCU) = '10999' AND IXEFFF <= :fecha AND (IXEFFT >= :fecha OR IXEFFT = 0)
      `;
      const res = await conn.execute(bomSql, { fecha });
      const rows = res.rows as BomRow[];
      const index = new Map<string, BomLine[]>();
      for (const r of rows) {
        if (!index.has(r.K)) index.set(r.K, []);
        index.get(r.K)!.push({ componente: r.L, itemCortoComponente: r.ITM_L, qty: r.QTY / 10000, um: r.UM });
      }
      bomPorFecha.set(fecha, index);
    }

    // C) Explosión recursiva en memoria, por cada (artículo padre, mes) previsto.
    const materiales = new Map<string, MaterialAgg>();

    function explode(parent: string, factor: number, index: Map<string, BomLine[]>, bucket: ForecastBucket, visitados: Set<string>) {
      const lines = index.get(parent) ?? [];
      for (const line of lines) {
        const prefijo = line.componente.slice(0, 2);
        const effQty = factor * line.qty;
        if (TIPOS_INTERMEDIOS.has(prefijo)) {
          // Corta ciclos (no debería darse en un BOM real, pero un ciclo aquí
          // colgaría la petición si no se corta).
          if (visitados.has(line.componente)) continue;
          const siguiente = new Set(visitados);
          siguiente.add(line.componente);
          explode(line.componente, effQty, index, bucket, siguiente);
        } else {
          if (!materiales.has(line.componente)) {
            materiales.set(line.componente, {
              itemCorto: line.itemCortoComponente,
              um: line.um,
              total: 0,
              contribuciones: new Map(),
            });
          }
          const mat = materiales.get(line.componente)!;
          const cantidad = effQty * bucket.qty;
          mat.total += cantidad;
          const contribKey = `${bucket.item}::${bucket.sortKey}`;
          const existing = mat.contribuciones.get(contribKey);
          if (existing) existing.qty += cantidad;
          else mat.contribuciones.set(contribKey, { root: bucket.item, rootCorto: bucket.itemCorto, sortKey: bucket.sortKey, mesLabel: bucket.mesLabel, qty: cantidad });
        }
      }
    }

    for (const bucket of buckets) {
      const index = bomPorFecha.get(bucket.fechaJde);
      if (!index) continue;
      explode(bucket.item, 1, index, bucket, new Set([bucket.item]));
    }

    // D) Descripciones (F4101) — materiales finales + artículos padre, por código corto.
    const codigosCortos = Array.from(new Set([
      ...Array.from(materiales.values()).map((m) => m.itemCorto),
      ...buckets.map((b) => Number(b.itemCorto)),
    ])).filter((v) => Number.isFinite(v));

    let metaMap = new Map<number, { descripcion: string; familia: string }>();
    if (codigosCortos.length > 0) {
      const placeholders = codigosCortos.map((_, i) => `:c${i}`).join(', ');
      const metaSql = `SELECT IMITM AS ITEM, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA FROM F4101 WHERE IMITM IN (${placeholders})`;
      const metaBinds: Record<string, number> = {};
      codigosCortos.forEach((v, i) => { metaBinds[`c${i}`] = v; });
      const metaResult = await conn.execute(metaSql, metaBinds);
      const metaRows = metaResult.rows as { ITEM: number; DESCRIPCION: string; FAMILIA: string }[];
      metaMap = new Map(metaRows.map((r) => [r.ITEM, { descripcion: r.DESCRIPCION, familia: r.FAMILIA }]));
    }

    // E) Catálogo de familia (UDC 41/S2) — descripción real del código IMSRP2, mismo
    // patrón que /api/compras (familiaCatalogSql). Sin esto se veía "Familia 132" en
    // vez del nombre real.
    const familiaCatalogResult = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S2' AND TRIM(DRKY) IS NOT NULL`
    );
    const familiaDescMap = new Map(
      (familiaCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, r.DESCRIPCION])
    );

    const materialesOut = Array.from(materiales.entries())
      .map(([codigo, m]) => {
        const meta = metaMap.get(m.itemCorto);
        const familia = meta?.familia || '';
        return {
          codigo,
          descripcion: meta?.descripcion || '',
          familia,
          familiaDescripcion: familiaDescMap.get(familia) || familia,
          um: m.um,
          cantidad: Math.round(m.total * 1000) / 1000,
          contribuciones: Array.from(m.contribuciones.values())
            .map((c) => ({
              articuloPadre: c.root,
              descripcionPadre: metaMap.get(Number(c.rootCorto))?.descripcion || '',
              mes: c.mesLabel,
              sortKey: c.sortKey,
              cantidad: Math.round(c.qty * 1000) / 1000,
            }))
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || b.cantidad - a.cantidad),
        };
      })
      .sort((a, b) => b.cantidad - a.cantidad);

    return NextResponse.json({
      materiales: materialesOut,
      meta: {
        articulosPrevistos: new Set(buckets.map((b) => b.item)).size,
        meses: Array.from(new Set(buckets.map((b) => b.sortKey))).sort(),
      },
    });
  } catch (error) {
    console.error('Error en /api/mrp:', error);
    return NextResponse.json({ error: 'Error al calcular la explosión de compras' }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}
