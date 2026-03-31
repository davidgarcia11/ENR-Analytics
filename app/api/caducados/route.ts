import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getDayOfYear } from 'date-fns';

function jdeDateToISO(jdeDate: number): string | null {
    if (!jdeDate || jdeDate <= 0) return null;
    const str = String(jdeDate).padStart(6, '0');
    const yy = parseInt(str.substring(1, 3), 10);
    const ddd = parseInt(str.substring(3), 10);
    const year = 2000 + yy;
    const date = new Date(year, 0, ddd);
    if (isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);

    const plant = searchParams.get('plant');
    const type = searchParams.get('type') || 'todos'; // caducados | obsoletos | bloqueados | todos
    const location = searchParams.get('location'); // filtro por ubicación

    // Calcular fecha JDE de hoy: 1YYDDD
    const today = new Date();
    const yy = today.getFullYear() - 2000;
    const ddd = getDayOfYear(today);
    const todayJde = 100000 + (yy * 1000) + ddd;

    let conn;
    try {
        conn = await getDbConnection();

        // Obtener nombres de planta desde F0006
        const plantResult = await conn.execute(
            `SELECT TRIM(MCMCU) AS PLANT_CODE, TRIM(MCDL01) AS PLANT_NAME FROM F0006 WHERE MCSTYL = 'BP'`
        );
        const plantNames: Record<string, string> = {};
        for (const r of plantResult.rows as any[]) {
            plantNames[String(r.PLANT_CODE || '').trim()] = String(r.PLANT_NAME || '').trim();
        }

        // Obtener ubicaciones únicas desde F4100
        const locResult = await conn.execute(
            `SELECT DISTINCT TRIM(LMLOCN) AS LOCN FROM F4100 ORDER BY TRIM(LMLOCN)`
        );
        const locations = (locResult.rows as any[]).map(r => String(r.LOCN || '').trim());

        // Query principal: F41021 (stock) + F4101 (artículo) + F4108 (palet/lote/caducidad/bloqueado)
        let sql = `
          SELECT
            TRIM(D.IMLITM) AS IMLITM,
            A.LIITM          AS LIITM,
            TRIM(A.LILOTN)  AS LILOTN,
            TRIM(A.LILOCN)  AS LILOCN,
            TRIM(A.LIMCU)   AS LIMCU,
            A.LIPQOH         AS LIPQOH,
            TRIM(B.IOLOT1)  AS IOLOT1,
            TRIM(B.IOLOT2)  AS IOLOT2,
            B.IOMMEJ         AS IOMMEJ,
            TRIM(B.IOLOTS)  AS IOLOTS,
            TRIM(D.IMDSC1)  AS IMDSC1,
            TRIM(D.IMSTKT)  AS IMSTKT
          FROM F41021 A
          INNER JOIN F4101 D ON D.IMITM = A.LIITM
          INNER JOIN F4108 B ON B.IOLOTN = A.LILOTN AND B.IOITM = A.LIITM AND B.IOMCU = A.LIMCU
            AND (TRIM(B.IOLOT1) IS NOT NULL OR TRIM(B.IOLOT2) IS NOT NULL)
          WHERE A.LIPQOH > 0
        `;
        const binds: any = {};

        // Filtro por tipo
        if (type === 'caducados') {
            sql += ` AND B.IOMMEJ < :todayJde AND B.IOMMEJ > 0`;
            binds.todayJde = todayJde;
        } else if (type === 'obsoletos') {
            sql += ` AND D.IMSTKT = 'O'`;
        } else if (type === 'bloqueados') {
            sql += ` AND B.IOLOTS = 'B'`;
        } else {
            // todos: caducados OR obsoletos OR bloqueados
            sql += ` AND ((B.IOMMEJ < :todayJde AND B.IOMMEJ > 0) OR D.IMSTKT = 'O' OR B.IOLOTS = 'B')`;
            binds.todayJde = todayJde;
        }

        // Filtro por planta
        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.LIMCU) = :plant`;
            binds.plant = plant;
        }

        // Filtro por ubicación
        if (location && location !== 'all') {
            if (location === '__blank__') {
                sql += ` AND (TRIM(A.LILOCN) IS NULL OR TRIM(A.LILOCN) = '')`;
            } else {
                sql += ` AND TRIM(A.LILOCN) = :location`;
                binds.location = location;
            }
        }

        sql += ` ORDER BY B.IOMMEJ ASC NULLS LAST FETCH FIRST 5000 ROWS ONLY`;

        const result = await conn.execute(sql, binds);
        const rows = result.rows as any[];

        // Procesar filas
        let countCaducados = 0;
        let countObsoletos = 0;
        let countBloqueados = 0;
        let countAmbos = 0;
        let totalQuantity = 0;

        const data = rows.map(row => {
            const isExpired = row.IOMMEJ > 0 && row.IOMMEJ < todayJde;
            const isObsolete = String(row.IMSTKT || '').trim() === 'O';
            const isBlocked = String(row.IOLOTS || '').trim() === 'B';

            const motivos: string[] = [];
            if (isExpired) motivos.push('Caducado');
            if (isObsolete) motivos.push('Obsoleto');
            if (isBlocked) motivos.push('Bloqueado');
            const motivo = motivos.join(' + ') || 'Desconocido';

            if (isExpired) countCaducados++;
            if (isObsolete) countObsoletos++;
            if (isBlocked) countBloqueados++;
            if (motivos.length > 1) countAmbos++;

            const quantity = (row.LIPQOH || 0) / 100;
            totalQuantity += quantity;

            const plantCode = String(row.LIMCU || '').trim();
            const loc = String(row.LILOCN || '').trim();

            return {
                articleLong: String(row.IMLITM || '').trim(),
                articleShort: row.LIITM,
                description: String(row.IMDSC1 || '').trim(),
                plantCode,
                plantName: plantNames[plantCode] || plantCode,
                paletLote: String(row.LILOTN || '').trim(),
                palet: String(row.IOLOT1 || '').trim(),
                lote: String(row.IOLOT2 || '').trim(),
                location: loc,
                quantity,
                expiryDateJde: row.IOMMEJ,
                expiryDate: jdeDateToISO(row.IOMMEJ),
                motivo,
            };
        });

        // Logging en SQLite
        try {
            const user = await verifySession().catch(() => null);
            const filters = {
                plant: plant ? (plantNames[plant] || plant) : null,
                type,
                location
            };
            const db = getDb();
            db.prepare(
                'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                user?.id ?? null,
                user ? user.username : 'Invitado',
                'caducados_obsoletos',
                JSON.stringify(filters),
                data.length,
                Date.now() - startTime
            );
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        return NextResponse.json({
            data,
            locations,
            summary: {
                totalPallets: data.length,
                totalQuantity: Math.round(totalQuantity * 100) / 100,
                caducados: countCaducados,
                obsoletos: countObsoletos,
                bloqueados: countBloqueados,
                ambos: countAmbos,
            }
        });

    } catch (err: any) {
        console.error("Caducados Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
