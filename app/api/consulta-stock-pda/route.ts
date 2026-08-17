import { NextRequest, NextResponse } from 'next/server';
import { getReflexConnection, sql } from '@/lib/reflex';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';

// SSCC de palet: siempre 18 dígitos (AI 00 de GS1-128, ver lib/gs1.ts)
const SSCC_REGEX = /^\d{18}$/;

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

// HLSUPPP.SUCQAL: código de calidad del soporte/palet. 'STD' = calidad estándar, válido
// para consumir; cualquier otro código (CAD, CAL, CUA, PTE, ROT, OBS, M01-M09...) es un
// bloqueo de calidad (confirmado contra datos reales de Reflex). No se distingue el motivo
// concreto en el mensaje al operario, solo "bloqueado por Calidad" — el código exacto no
// aporta nada accionable en el PDA.
function esBloqueadoPorCalidad(sucqal: string | null): boolean {
    const v = (sucqal || '').trim().toUpperCase();
    return v !== '' && v !== 'STD';
}

interface PaletRow {
    lote: string; sscc: string | null; cantidad: number
    fechaCaducidad: string | null; ubicacion: string | null; planta: string | null
    caducado: boolean; bloqueado: boolean; primeroEnCaducar: boolean
}

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('consulta_stock_pda')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);
    const planta = searchParams.get('planta') || '';
    const sscc = searchParams.get('sscc') || '';

    if (planta && !(planta in PLANTAS)) {
        return NextResponse.json({ error: 'Planta inválida' }, { status: 400 });
    }
    if (!sscc) {
        return NextResponse.json({ error: 'Debes escanear el número de palet (SSCC)' }, { status: 400 });
    }
    if (!SSCC_REGEX.test(sscc)) {
        return NextResponse.json({ error: 'SSCC inválido' }, { status: 400 });
    }

    let conn: sql.ConnectionPool | undefined;
    try {
        conn = await getReflexConnection();

        // HLGEINP: lote/SSCC/cantidad/caducidad por artículo. HLARTIP: maestro de artículo
        // (descripción + activo/inactivo). HLSUPPP: soporte (palet) -> depósito+ubicación+calidad.
        // HLEMPLP: maestro de ubicaciones.
        // INNER JOIN a HLARTIP con ARTOPD = 0 (activo): un artículo desactivado se trata como no encontrado.
        // Filtro de planta opcional (e.EMCDPO): filtra toda la consulta (listado y validación de SSCC)
        // a los lotes ubicados en esa planta.
        // Identidad del artículo: se resuelve por el SSCC escaneado (palet), y se devuelven TODOS los
        // lotes de ese artículo (no solo el SSCC escaneado) para poder validar FEFO. El IN en vez de
        // "=" es por si el mismo SSCC tuviera más de una fila en HLGEINP.
        const request = conn.request();
        request.input('sscc', sql.VarChar(18), sscc);
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
                    e.EMCDPO  AS plantaCod,
                    s.SUCQAL  AS calidad
                FROM reflex.HLGEINP g
                INNER JOIN reflex.HLARTIP a ON a.ARCART = g.GECART AND a.ARTOPD = 0
                LEFT JOIN reflex.HLSUPPP s ON s.SUNSUP = g.GENSUP
                LEFT JOIN reflex.HLEMPLP e ON e.EMCDPO = s.SUCDPO AND e.EMNEMP = s.SUNEMP
                WHERE g.GECART IN (SELECT GECART FROM reflex.HLGEINP WHERE GENSUP = @sscc)
                  AND g.GEQGEI > 0
                  ${planta ? 'AND e.EMCDPO = @planta' : ''}
                ORDER BY g.GEADLC ASC, g.GEMDLC ASC, g.GEJDLC ASC
            `);

        const rows = result.recordset as any[];
        const articulo = rows.length > 0 ? rows[0].articulo : null;
        const descripcion = rows.length > 0 ? (rows[0].descripcion || '').trim() || null : null;

        // hoy en ISO (YYYY-MM-DD): comparación lexicográfica segura contra fechaCaducidad
        const hoyIso = new Date().toISOString().slice(0, 10);

        const palets: Omit<PaletRow, 'primeroEnCaducar'>[] = rows.map(r => {
            const codigoUbicacion = [r.emc1, r.emc2, r.emc3, r.emc4, r.emc5]
                .map((v: string | null) => (v || '').trim())
                .filter(Boolean)
                .join('-');
            const fechaCaducidad = buildFechaCaducidadConFallback(r);
            return {
                lote: r.lote,
                sscc: r.sscc,
                cantidad: r.cantidad,
                fechaCaducidad,
                ubicacion: (r.ubicacionDesc || '').trim() || codigoUbicacion || null,
                planta: PLANTAS[(r.plantaCod || '').trim()] || r.plantaCod || null,
                caducado: fechaCaducidad !== null && fechaCaducidad < hoyIso,
                bloqueado: esBloqueadoPorCalidad(r.calidad),
            };
        });

        // "Primero en caducar" real: solo cuenta entre los palets consumibles (ni caducados
        // ni bloqueados) — no tiene sentido destacar como "el que hay que coger primero" un
        // palet que en realidad no se puede consumir.
        const consumibles = palets.filter(p => !p.caducado && !p.bloqueado && p.fechaCaducidad);
        const primerConsumible = consumibles.length > 0
            ? consumibles.reduce((min, p) => p.fechaCaducidad! < min.fechaCaducidad! ? p : min)
            : null;

        const lotes: PaletRow[] = palets
            .map(p => ({ ...p, primeroEnCaducar: primerConsumible !== null && p.sscc === primerConsumible.sscc }))
            // FEFO real: al mezclar DLC y DLU no todas las filas vienen ya ordenadas desde el ORDER BY de la query
            .sort((a, b) => {
                if (!a.fechaCaducidad && !b.fechaCaducidad) return 0;
                if (!a.fechaCaducidad) return 1;
                if (!b.fechaCaducidad) return -1;
                return a.fechaCaducidad.localeCompare(b.fechaCaducidad);
            });

        // Agrupado por lote para la tabla (ver docs/consulta-stock-pda.md §7 para el porqué)
        const gruposPorLote = new Map<string, PaletRow[]>();
        for (const p of lotes) {
            const grupo = gruposPorLote.get(p.lote) ?? [];
            grupo.push(p);
            gruposPorLote.set(p.lote, grupo);
        }
        const grupos = Array.from(gruposPorLote.entries())
            .map(([lote, paletsDelLote]) => ({
                lote,
                fechaCaducidad: paletsDelLote.find(p => p.fechaCaducidad)?.fechaCaducidad ?? null,
                cantidadTotal: paletsDelLote.reduce((sum, p) => sum + (p.cantidad || 0), 0),
                cantidadBloqueada: paletsDelLote.filter(p => p.bloqueado).reduce((sum, p) => sum + (p.cantidad || 0), 0),
                totalPalets: paletsDelLote.length,
                paletsBloqueados: paletsDelLote.filter(p => p.bloqueado).length,
                palets: paletsDelLote,
            }))
            .sort((a, b) => {
                if (!a.fechaCaducidad && !b.fechaCaducidad) return 0;
                if (!a.fechaCaducidad) return 1;
                if (!b.fechaCaducidad) return -1;
                return a.fechaCaducidad.localeCompare(b.fechaCaducidad);
            });

        // Validación del palet escaneado. Prioridad de avisos cuando coinciden varios:
        // Caducado > Bloqueado por calidad > hay lote anterior (esta última solo se comprueba
        // si el propio palet es consumible, y solo contra otros palets también consumibles —
        // no tiene sentido decir "hay uno antes" si ese "antes" está caducado o bloqueado).
        let validacionSscc: { estado: 'correcto' | 'aviso' | 'no_encontrado' | 'sin_fecha'; mensajes: string[] };
        const escaneado = lotes.find(l => l.sscc === sscc);
        if (!escaneado) {
            validacionSscc = {
                estado: 'no_encontrado',
                mensajes: [`Palet no está en stock${planta ? ` en ${PLANTAS[planta]}` : ''}`],
            };
        } else {
            const avisos: string[] = [];
            if (escaneado.caducado) avisos.push('Este palet no se puede consumir: está Caducado.');
            if (escaneado.bloqueado) avisos.push('Este palet no se puede consumir: está bloqueado por Calidad.');

            if (avisos.length > 0) {
                validacionSscc = { estado: 'aviso', mensajes: avisos };
            } else if (!escaneado.fechaCaducidad) {
                validacionSscc = {
                    estado: 'sin_fecha',
                    mensajes: ['Este palet no tiene fecha de caducidad registrada; no se puede comprobar si hay lotes anteriores.'],
                };
            } else {
                const hayAnterior = consumibles.some(p => p.sscc !== sscc && p.fechaCaducidad! < escaneado.fechaCaducidad!);
                validacionSscc = hayAnterior
                    ? { estado: 'aviso', mensajes: ['Este palet no se puede consumir: hay lotes de este artículo que caducan antes.'] }
                    : { estado: 'correcto', mensajes: ['Correcto para consumir.'] };
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
                JSON.stringify({ sscc, planta: planta || undefined }),
                lotes.length,
                Date.now() - startTime
            );
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        return NextResponse.json({ articulo, descripcion, grupos, validacionSscc });
    } catch (err: any) {
        console.error('Consulta stock PDA Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
