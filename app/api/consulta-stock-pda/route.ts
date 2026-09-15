import { NextRequest, NextResponse } from 'next/server';
import { getReflexConnection, sql } from '@/lib/reflex';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';
import { FUNES_SUBPLANTS, funesSubplantLabel, plantHasSubplants } from '@/lib/plants';

// SSCC de palet: siempre 18 dígitos (AI 00 de GS1-128, ver lib/gs1.ts)
const SSCC_REGEX = /^\d{18}$/;

// Código de depósito físico (HLEMPLP.EMCDPO) -> nombre de planta
const PLANTAS: Record<string, string> = {
    '001': 'Aguilar',
    '002': 'Corella',
    '004': 'Funes',
    '006': 'Tudefrigo',
};

// Nombre de la ubicación consultada, para los mensajes al operario ("Funes 1" es más
// preciso que "Funes" cuando se ha acotado a una sub-planta).
function nombreUbicacionConsultada(planta: string, subplanta: string): string | null {
    if (!planta) return null;
    return (subplanta ? funesSubplantLabel(subplanta) : null) ?? PLANTAS[planta] ?? null;
}

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
    subplanta: string | null // código EMCMGN, solo informativo (null fuera de Funes)
    caducado: boolean; bloqueado: boolean; primeroEnCaducar: boolean
}

// Palet tal como sale de la query, antes de marcar el "primero en caducar"
type PaletBase = Omit<PaletRow, 'primeroEnCaducar'>;

export interface ValidacionSscc {
    estado: 'correcto' | 'aviso' | 'no_encontrado' | 'sin_fecha' | 'otra_subplanta'
    mensajes: string[]
    nota?: string          // información secundaria, se muestra en cualquier estado
    subplantaReal?: string // código EMCMGN donde SÍ está el lote, para ofrecer el cambio
}

/**
 * Decide si el palet escaneado se puede consumir. Función pura (testeada en
 * `__tests__/consulta-stock-pda-validacion.test.ts`) — no toca red ni BD.
 *
 * **La unidad de decisión es el LOTE, no el palet**: lo que determina si el operario puede
 * consumir es si ese lote está en su nave y si hay otro LOTE de la nave que caduque antes. El
 * palet solo aporta su propio estado (caducado/bloqueado, que sí es por palet: dentro de un mismo
 * lote puede haber palets bloqueados y otros no — comprobado con datos reales).
 *
 * Prioridad de avisos cuando coinciden varios: Caducado > Bloqueado por calidad > hay lote
 * anterior (esta última solo se comprueba si el propio palet es consumible, y solo contra otros
 * lotes también consumibles — no tiene sentido decir "hay uno antes" si ese "antes" está caducado
 * o bloqueado).
 *
 * @param sscc            SSCC escaneado
 * @param todosLosPalets  Todos los palets del artículo en la planta, SIN filtrar por sub-planta
 * @param palets          Los de la nave consultada (`todosLosPalets` si no se filtró)
 * @param consumibles     Subconjunto de `palets` ni caducado ni bloqueado y con fecha
 * @param ubicacionConsultada Nombre legible de la planta/sub-planta consultada, para los mensajes
 */
export function validarPaletEscaneado(
    sscc: string,
    todosLosPalets: PaletBase[],
    palets: PaletBase[],
    consumibles: PaletBase[],
    ubicacionConsultada: string | null,
    subplanta: string,
): ValidacionSscc {
    const noEncontrado: ValidacionSscc = {
        estado: 'no_encontrado',
        mensajes: [`Palet no está en stock${ubicacionConsultada ? ` en ${ubicacionConsultada}` : ''}`],
    };

    const paletEscaneado = todosLosPalets.find(p => p.sscc === sscc);
    if (!paletEscaneado) return noEncontrado;

    const loteEscaneado = paletEscaneado.lote;
    // ¿Hay stock de ESE LOTE en la nave consultada? (`palets` ya viene filtrado por sub-planta)
    if (!palets.some(p => p.lote === loteEscaneado)) {
        // El lote entero está en la otra nave: decírselo explícitamente (el operario puede haberse
        // movido y no haber cambiado el selector) en vez del genérico "no está en stock".
        const subplantaDelLote = todosLosPalets
            .find(p => p.lote === loteEscaneado && p.subplanta && p.subplanta !== subplanta)?.subplanta;
        if (!subplantaDelLote) return noEncontrado;
        return {
            estado: 'otra_subplanta',
            subplantaReal: subplantaDelLote,
            mensajes: [
                `Este lote está en ${funesSubplantLabel(subplantaDelLote) ?? 'otra sub-planta'}, no en ${ubicacionConsultada ?? 'la sub-planta consultada'}.`,
            ],
        };
    }

    // El lote sí está en la nave. Si el palet concreto que escaneó está registrado en la otra
    // (movimiento físico sin registrar, típico), no se le corta el flujo: el lote está disponible
    // donde está, solo se le avisa de la discrepancia.
    const paletEnOtraNave = !palets.some(p => p.sscc === sscc);
    const nota = paletEnOtraNave && paletEscaneado.subplanta
        ? `Ojo: este palet está registrado en ${funesSubplantLabel(paletEscaneado.subplanta) ?? 'otra sub-planta'}, aunque el lote sí está en ${ubicacionConsultada ?? 'esta sub-planta'}.`
        : undefined;

    const avisos: string[] = [];
    if (paletEscaneado.caducado) avisos.push('Este palet no se puede consumir: está Caducado.');
    if (paletEscaneado.bloqueado) avisos.push('Este palet no se puede consumir: está bloqueado por Calidad.');
    if (avisos.length > 0) return { estado: 'aviso', mensajes: avisos, nota };

    if (!paletEscaneado.fechaCaducidad) {
        return {
            estado: 'sin_fecha',
            mensajes: ['Este palet no tiene fecha de caducidad registrada; no se puede comprobar si hay lotes anteriores.'],
            nota,
        };
    }

    // Comparación LOTE contra LOTE: se excluye el lote escaneado entero (no solo el palet), para
    // no avisar contra sí mismo si dos palets del mismo lote resolvieran fechas distintas al
    // mezclar DLC y DLU (§6.2) — caso real: el lote 123456 tiene 2026-05-25 en una nave y
    // 2026-08-04 en la otra.
    const hayAnterior = consumibles.some(p =>
        p.lote !== loteEscaneado && p.fechaCaducidad! < paletEscaneado.fechaCaducidad!);
    return hayAnterior
        ? { estado: 'aviso', mensajes: ['Este palet no se puede consumir: hay lotes de este artículo que caducan antes.'], nota }
        : { estado: 'correcto', mensajes: ['Correcto para consumir.'], nota };
}

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('consulta_stock_pda')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);
    const planta = searchParams.get('planta') || '';
    const subplanta = searchParams.get('subplanta') || '';
    const sscc = searchParams.get('sscc') || '';

    if (planta && !(planta in PLANTAS)) {
        return NextResponse.json({ error: 'Planta inválida' }, { status: 400 });
    }
    if (subplanta) {
        if (!plantHasSubplants(planta)) {
            return NextResponse.json({ error: 'Esa planta no tiene sub-plantas' }, { status: 400 });
        }
        if (!FUNES_SUBPLANTS.some(s => s.reflex === subplanta)) {
            return NextResponse.json({ error: 'Sub-planta inválida' }, { status: 400 });
        }
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
        // La sub-planta (e.EMCMGN) se trae como columna pero NO se filtra en SQL: el filtro se aplica
        // después en JS para poder detectar que el palet escaneado está en la otra sub-planta y
        // decírselo al operario, en vez de responder un genérico "no está en stock" (ver §7.5 de la doc).
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
                    e.EMCMGN  AS subplantaCod,
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

        const todosLosPalets: Omit<PaletRow, 'primeroEnCaducar'>[] = rows.map(r => {
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
                subplanta: (r.subplantaCod || '').trim() || null,
                caducado: fechaCaducidad !== null && fechaCaducidad < hoyIso,
                bloqueado: esBloqueadoPorCalidad(r.calidad),
            };
        });

        // Filtro de sub-planta (solo Funes). Los palets SIN sub-planta asignada en el maestro de
        // ubicaciones se dejan pasar siempre: son ubicaciones de tránsito/playa de Funes (muelles,
        // transpaletas, apiladoras — hoy 0 palets con stock, comprobado), accesibles desde cualquier
        // nave. Ocultarlas escondería stock real; mismo criterio defensivo que los LEFT JOIN de §6.1.
        const palets = subplanta
            ? todosLosPalets.filter(p => p.subplanta === null || p.subplanta === subplanta)
            : todosLosPalets;

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

        // Validación del palet escaneado (lógica pura y testeada, ver validarPaletEscaneado arriba)
        const validacionSscc = validarPaletEscaneado(
            sscc,
            todosLosPalets,
            palets,
            consumibles,
            nombreUbicacionConsultada(planta, subplanta),
            subplanta,
        );

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
                JSON.stringify({ sscc, planta: planta || undefined, subplanta: subplanta || undefined }),
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
