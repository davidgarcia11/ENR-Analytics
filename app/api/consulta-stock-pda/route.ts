import { NextRequest, NextResponse } from 'next/server';
import { getReflexConnection, sql } from '@/lib/reflex';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';

// EAN-8, EAN-13/UPC-A o GTIN-14, siempre numérico
const EAN_REGEX = /^\d{8,14}$/;
// SSCC de palet: siempre 18 dígitos (AI 00 de GS1-128, ver lib/gs1.ts)
const SSCC_REGEX = /^\d{18}$/;
// Algunas etiquetas reales no llevan EAN y traen el AI 01/02 relleno a ceros (ej. "00000000000000")
const EAN_SIN_DATOS_REGEX = /^0+$/;

// Código de depósito físico (HLEMPLP.EMCDPO) -> nombre de planta
const PLANTAS: Record<string, string> = {
    '001': 'Aguilar',
    '002': 'Corella',
    '004': 'Funes',
    '006': 'Tudefrigo',
};

// HLGEINP guarda la caducidad en 3 campos separados; el año viene a 2 dígitos (26 -> 2026)
function buildFechaCaducidad(dia: number | null, mes: number | null, anio: number | null): string | null {
    if (!dia || !mes || !anio) return null;
    return `${2000 + anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Algunos artículos no rellenan DLC (GEJDLC/GEMDLC/GEADLC) y usan en su lugar DLU
// (GEJDLU/GEMDLU/GEADLU) — mismo formato, se usa como fallback cuando la DLC está a 0.
function buildFechaCaducidadConFallback(r: any): string | null {
    return buildFechaCaducidad(r.diaCad, r.mesCad, r.anioCad) ?? buildFechaCaducidad(r.diaCadLu, r.mesCadLu, r.anioCadLu);
}

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('consulta_stock_pda')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);
    const ean = searchParams.get('ean') || '';
    const planta = searchParams.get('planta') || '';
    const sscc = searchParams.get('sscc') || '';

    if (ean && !EAN_REGEX.test(ean)) {
        return NextResponse.json({ error: 'EAN inválido' }, { status: 400 });
    }
    if (planta && !(planta in PLANTAS)) {
        return NextResponse.json({ error: 'Planta inválida' }, { status: 400 });
    }
    if (sscc && !SSCC_REGEX.test(sscc)) {
        return NextResponse.json({ error: 'SSCC inválido' }, { status: 400 });
    }
    // Etiquetas sin EAN real: puede faltar del todo (solo SSCC) o venir a ceros ("00000000000000").
    // En ambos casos, identificar el artículo por el SSCC en su lugar.
    const buscarPorSscc = !ean || EAN_SIN_DATOS_REGEX.test(ean);
    if (buscarPorSscc && !sscc) {
        return NextResponse.json({ error: 'No se ha podido identificar el artículo: falta el EAN y no se ha escaneado el SSCC del palet' }, { status: 400 });
    }

    let conn: sql.ConnectionPool | undefined;
    try {
        conn = await getReflexConnection();

        // HLVLIDP: identificador (EAN) -> artículo. HLARTIP: maestro de artículo (descripción + activo/inactivo).
        // HLGEINP: lote/SSCC/cantidad/caducidad por artículo. HLSUPPP: soporte (palet) -> depósito+ubicación.
        // HLEMPLP: maestro de ubicaciones.
        // INNER JOIN a HLARTIP con ARTOPD = 0 (activo): un artículo desactivado se trata como no encontrado.
        // Filtro de planta opcional (e.EMCDPO): filtra toda la consulta (listado y validación de SSCC)
        // a los lotes ubicados en esa planta.
        // Identidad del artículo: normalmente por EAN (HLVLIDP). Si la etiqueta no trae EAN real
        // (buscarPorSscc), se resuelve directamente por el SSCC del palet en HLGEINP.
        const desdeArticulo = buscarPorSscc
            ? `FROM reflex.HLGEINP g
               INNER JOIN reflex.HLARTIP a ON a.ARCART = g.GECART AND a.ARTOPD = 0`
            : `FROM reflex.HLVLIDP v
               INNER JOIN reflex.HLGEINP g ON g.GECART = v.VICART
               INNER JOIN reflex.HLARTIP a ON a.ARCART = v.VICART AND a.ARTOPD = 0`;
        const filtroIdentidad = buscarPorSscc
            ? 'g.GECART IN (SELECT GECART FROM reflex.HLGEINP WHERE GENSUP = @sscc)'
            : 'v.VICIVL = @ean';

        const request = conn.request();
        if (buscarPorSscc) {
            request.input('sscc', sql.VarChar(18), sscc);
        } else {
            request.input('ean', sql.VarChar(14), ean);
        }
        if (planta) request.input('planta', sql.Char(3), planta);
        const result = await request.query(`
                SELECT
                    g.GECART  AS articulo,
                    a.ARLART  AS descripcion,
                    g.GELOTF  AS lote,
                    g.GENSUP  AS sscc,
                    g.GEQGEI  AS cantidad,
                    g.GEJDLC  AS diaCad,
                    g.GEMDLC  AS mesCad,
                    g.GEADLC  AS anioCad,
                    g.GEJDLU  AS diaCadLu,
                    g.GEMDLU  AS mesCadLu,
                    g.GEADLU  AS anioCadLu,
                    e.EMLIEM  AS ubicacionDesc,
                    e.EMC1EM  AS emc1, e.EMC2EM AS emc2, e.EMC3EM AS emc3, e.EMC4EM AS emc4, e.EMC5EM AS emc5,
                    e.EMCDPO  AS plantaCod
                ${desdeArticulo}
                LEFT JOIN reflex.HLSUPPP s ON s.SUNSUP = g.GENSUP
                LEFT JOIN reflex.HLEMPLP e ON e.EMCDPO = s.SUCDPO AND e.EMNEMP = s.SUNEMP
                WHERE ${filtroIdentidad}
                  AND g.GEQGEI > 0
                  ${planta ? 'AND e.EMCDPO = @planta' : ''}
                ORDER BY g.GEADLC ASC, g.GEMDLC ASC, g.GEJDLC ASC
            `);

        const rows = result.recordset as any[];
        const articulo = rows.length > 0 ? rows[0].articulo : null;
        const descripcion = rows.length > 0 ? (rows[0].descripcion || '').trim() || null : null;
        const lotes = rows
            .map(r => {
                const codigoUbicacion = [r.emc1, r.emc2, r.emc3, r.emc4, r.emc5]
                    .map((v: string | null) => (v || '').trim())
                    .filter(Boolean)
                    .join('-');
                return {
                    lote: r.lote,
                    sscc: r.sscc,
                    cantidad: r.cantidad,
                    fechaCaducidad: buildFechaCaducidadConFallback(r),
                    ubicacion: (r.ubicacionDesc || '').trim() || codigoUbicacion || null,
                    planta: PLANTAS[(r.plantaCod || '').trim()] || r.plantaCod || null,
                };
            })
            // FEFO real: al mezclar DLC y DLU no todas las filas vienen ya ordenadas desde el ORDER BY de la query
            .sort((a, b) => {
                if (!a.fechaCaducidad && !b.fechaCaducidad) return 0;
                if (!a.fechaCaducidad) return 1;
                if (!b.fechaCaducidad) return -1;
                return a.fechaCaducidad.localeCompare(b.fechaCaducidad);
            });

        // Validación FEFO del palet escaneado (solo si el código traía SSCC, AI 00):
        // ¿hay algún otro lote de este mismo artículo (y planta, si se filtró) que caduque antes?
        let validacionSscc: { estado: 'correcto' | 'incorrecto' | 'no_encontrado' | 'sin_fecha'; mensaje: string } | null = null;
        if (sscc) {
            const escaneado = lotes.find(l => l.sscc === sscc);
            if (!escaneado) {
                validacionSscc = {
                    estado: 'no_encontrado',
                    mensaje: `Palet no está en stock${planta ? ` en ${PLANTAS[planta]}` : ''}`,
                };
            } else if (!escaneado.fechaCaducidad) {
                validacionSscc = {
                    estado: 'sin_fecha',
                    mensaje: 'Este palet no tiene fecha de caducidad registrada; no se puede comprobar si hay lotes anteriores',
                };
            } else {
                const hayAnterior = lotes.some(l => l.sscc !== sscc && l.fechaCaducidad && l.fechaCaducidad < escaneado.fechaCaducidad!);
                validacionSscc = hayAnterior
                    ? { estado: 'incorrecto', mensaje: 'Este palet no se puede consumir: hay lotes de este artículo que caducan antes' }
                    : { estado: 'correcto', mensaje: 'Correcto para consumir: no hay lotes que caduquen antes' };
            }
        }

        // Logging en SQLite (nunca bloquea la respuesta)
        try {
            const user = await verifySession().catch(() => null);
            const db = getDb();
            db.prepare(
                'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                user?.id ?? null,
                user ? user.username : 'Invitado',
                'consulta_stock_pda',
                JSON.stringify({ ean: ean || undefined, planta: planta || undefined, sscc: sscc || undefined }),
                lotes.length,
                Date.now() - startTime
            );
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        return NextResponse.json({ articulo, descripcion, lotes, validacionSscc });
    } catch (err: any) {
        console.error('Consulta stock PDA Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
