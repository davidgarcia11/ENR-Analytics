import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';
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
    const denied = await requireScreenAccess('caducados')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);

    const filterPlants = searchParams.getAll('plant');
    const type = searchParams.get('type') || 'todos'; // caducados | obsoletos | bloqueados | todos
    const filterLocations = searchParams.getAll('location');
    const selectedLotStates = searchParams.getAll('lotStates');
    const onlyLotStates = searchParams.get('onlyLotStates') === '1';
    const srp1s = searchParams.getAll('srp1'); // Categoría
    const srp2s = searchParams.getAll('srp2'); // Familia
    const paletRaw = searchParams.get('palet') || '';
    const loteRaw  = searchParams.get('lote')  || '';

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

        // Obtener estados de lote desde F0005 (DRSY=41, DRRT=L) — blanco=válido
        const lotStatesResult = await conn.execute(
            `SELECT TRIM(F.DRKY) AS CODE, TRIM(F.DRDL01) AS DESCRIPTION
             FROM prodctl.f0005 F
             WHERE TRIM(F.DRSY) = '41'
               AND TRIM(F.DRRT) = 'L'
               AND TRIM(F.DRKY) IS NOT NULL
             ORDER BY TRIM(F.DRKY)`
        );
        const lotStateMap: Record<string, string> = {};
        const lotStates: { code: string; description: string }[] = [];
        for (const r of lotStatesResult.rows as any[]) {
            const code = String(r.CODE || '').trim();
            if (!code) continue;
            const desc = String(r.DESCRIPTION || '').trim();
            lotStateMap[code] = desc || code;
            lotStates.push({ code, description: desc || code });
        }

        // Modo ligero: solo devolver los estados de lote sin ejecutar la query principal
        if (onlyLotStates) {
            return NextResponse.json({ lotStates });
        }

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
            // Cualquier estado de lote no vacío (blanco = válido en JDE)
            sql += ` AND TRIM(B.IOLOTS) IS NOT NULL`;
        } else {
            // todos: caducados OR obsoletos OR cualquier estado de lote no vacío
            sql += ` AND ((B.IOMMEJ < :todayJde AND B.IOMMEJ > 0) OR D.IMSTKT = 'O' OR TRIM(B.IOLOTS) IS NOT NULL)`;
            binds.todayJde = todayJde;
        }

        // Filtro por tipo de bloqueo (aplica en cualquier modo, no solo bloqueados)
        if (selectedLotStates.length > 0) {
            const placeholders = selectedLotStates.map((_, i) => `:ls_${i}`).join(', ');
            sql += ` AND TRIM(B.IOLOTS) IN (${placeholders})`;
            selectedLotStates.forEach((v, i) => { binds[`ls_${i}`] = v; });
        }

        // Filtro por Categoría (IMSRP1 de F4101)
        if (srp1s.length > 0) {
            const placeholders = srp1s.map((_, i) => `:srp1_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP1) IN (${placeholders})`;
            srp1s.forEach((v, i) => { binds[`srp1_${i}`] = v; });
        }

        // Filtro por Familia (IMSRP2 de F4101)
        if (srp2s.length > 0) {
            const placeholders = srp2s.map((_, i) => `:srp2_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP2) IN (${placeholders})`;
            srp2s.forEach((v, i) => { binds[`srp2_${i}`] = v; });
        }

        // Filtro por Palet (IOLOT1) y Lote (IOLOT2) con soporte de comodín * → %
        if (paletRaw) {
            const pattern = paletRaw.replace(/\*/g, '%');
            if (pattern.includes('%')) {
                sql += ` AND TRIM(B.IOLOT1) LIKE :paletPattern`;
                binds.paletPattern = pattern;
            } else {
                sql += ` AND TRIM(B.IOLOT1) = :paletExact`;
                binds.paletExact = pattern;
            }
        }
        if (loteRaw) {
            const pattern = loteRaw.replace(/\*/g, '%');
            if (pattern.includes('%')) {
                sql += ` AND TRIM(B.IOLOT2) LIKE :lotePattern`;
                binds.lotePattern = pattern;
            } else {
                sql += ` AND TRIM(B.IOLOT2) = :loteExact`;
                binds.loteExact = pattern;
            }
        }

        // Filtro por planta
        if (filterPlants.length > 0) {
            const ph = filterPlants.map((_, i) => `:plant_${i}`).join(', ');
            sql += ` AND TRIM(A.LIMCU) IN (${ph})`;
            filterPlants.forEach((v, i) => { binds[`plant_${i}`] = v; });
        }

        // Filtro por ubicación
        if (filterLocations.length > 0) {
            const hasBlank = filterLocations.includes('__blank__');
            const realLocs = filterLocations.filter(l => l !== '__blank__');
            if (hasBlank && realLocs.length > 0) {
                const ph = realLocs.map((_, i) => `:loc_${i}`).join(', ');
                sql += ` AND (TRIM(A.LILOCN) IS NULL OR TRIM(A.LILOCN) = '' OR TRIM(A.LILOCN) IN (${ph}))`;
                realLocs.forEach((v, i) => { binds[`loc_${i}`] = v; });
            } else if (hasBlank) {
                sql += ` AND (TRIM(A.LILOCN) IS NULL OR TRIM(A.LILOCN) = '')`;
            } else {
                const ph = realLocs.map((_, i) => `:loc_${i}`).join(', ');
                sql += ` AND TRIM(A.LILOCN) IN (${ph})`;
                realLocs.forEach((v, i) => { binds[`loc_${i}`] = v; });
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
            const lotCode = String(row.IOLOTS || '').trim();
            const isBlocked = lotCode !== '';

            const motivos: string[] = [];
            if (isExpired) motivos.push('Caducado');
            if (isObsolete) motivos.push('Obsoleto');
            if (isBlocked) motivos.push(lotStateMap[lotCode] || lotCode);
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
                lotStatus: lotCode || null,
            };
        });

        // Logging en SQLite
        try {
            const user = await verifySession().catch(() => null);
            const filters = {
                plant: filterPlants.length > 0 ? filterPlants.join(', ') : null,
                type,
                location: filterLocations.length > 0 ? filterLocations.join(', ') : null,
                lotStates: selectedLotStates.length > 0 ? selectedLotStates : null,
                srp1: srp1s.length > 0 ? srp1s : null,
                srp2: srp2s.length > 0 ? srp2s : null,
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
            lotStates,
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
