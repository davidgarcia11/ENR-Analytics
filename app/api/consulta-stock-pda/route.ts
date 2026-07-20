import { NextRequest, NextResponse } from 'next/server';
import { getReflexConnection, sql } from '@/lib/reflex';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';

// EAN-8, EAN-13/UPC-A o GTIN-14, siempre numérico
const EAN_REGEX = /^\d{8,14}$/;

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

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('consulta_stock_pda')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);
    const ean = searchParams.get('ean') || '';

    if (!EAN_REGEX.test(ean)) {
        return NextResponse.json({ error: 'EAN inválido' }, { status: 400 });
    }

    let conn: sql.ConnectionPool | undefined;
    try {
        conn = await getReflexConnection();

        // HLVLIDP: identificador (EAN) -> artículo. HLGEINP: lote/SSCC/cantidad/caducidad por artículo.
        // HLSUPPP: soporte (palet) -> depósito+ubicación. HLEMPLP: maestro de ubicaciones.
        // No hay descripción de artículo disponible todavía; se muestra el código.
        const result = await conn.request()
            .input('ean', sql.VarChar(14), ean)
            .query(`
                SELECT
                    g.GECART  AS articulo,
                    g.GELOTF  AS lote,
                    g.GENSUP  AS sscc,
                    g.GEQGEI  AS cantidad,
                    g.GEJDLC  AS diaCad,
                    g.GEMDLC  AS mesCad,
                    g.GEADLC  AS anioCad,
                    e.EMLIEM  AS ubicacionDesc,
                    e.EMC1EM  AS emc1, e.EMC2EM AS emc2, e.EMC3EM AS emc3, e.EMC4EM AS emc4, e.EMC5EM AS emc5,
                    e.EMCDPO  AS plantaCod
                FROM reflex.HLVLIDP v
                INNER JOIN reflex.HLGEINP g ON g.GECART = v.VICART
                LEFT JOIN reflex.HLSUPPP s ON s.SUNSUP = g.GENSUP
                LEFT JOIN reflex.HLEMPLP e ON e.EMCDPO = s.SUCDPO AND e.EMNEMP = s.SUNEMP
                WHERE v.VICIVL = @ean
                  AND g.GEQGEI > 0
                ORDER BY g.GEADLC ASC, g.GEMDLC ASC, g.GEJDLC ASC
            `);

        const rows = result.recordset as any[];
        const articulo = rows.length > 0 ? rows[0].articulo : null;
        const lotes = rows.map(r => {
            const codigoUbicacion = [r.emc1, r.emc2, r.emc3, r.emc4, r.emc5]
                .map((v: string | null) => (v || '').trim())
                .filter(Boolean)
                .join('-');
            return {
                lote: r.lote,
                sscc: r.sscc,
                cantidad: r.cantidad,
                fechaCaducidad: buildFechaCaducidad(r.diaCad, r.mesCad, r.anioCad),
                ubicacion: (r.ubicacionDesc || '').trim() || codigoUbicacion || null,
                planta: PLANTAS[(r.plantaCod || '').trim()] || r.plantaCod || null,
            };
        });

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
                JSON.stringify({ ean }),
                lotes.length,
                Date.now() - startTime
            );
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        return NextResponse.json({ articulo, lotes });
    } catch (err: any) {
        console.error('Consulta stock PDA Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
