import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { parseJdeDate, parseWasOqs } from '@/lib/utils';
import { getDayOfYear } from 'date-fns';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const plant = searchParams.get('plant');
    const subLine = searchParams.get('subLine');
    const startDateStr = searchParams.get('startDate'); // YYYY-MM-DD
    const endDateStr = searchParams.get('endDate');

    let conn;
    try {
        conn = await getDbConnection();

        // Query F55TAR12 (Tasks) joined with F4801 (Orders)
        let sql = `
          SELECT A.WADOCO, B.TO55TAREA, A.WADL01, A.WASOQS, A.WAMCU, A.WAAITM, B.TOUM
          FROM F55TAR12 B
          INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
          WHERE 1=1
        `;
        const binds: any = {};

        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.WAMCU) = :plant`;
            binds.plant = plant;
        }

        if (subLine && subLine !== 'all') {
            // Filter by first digit using numeric range
            // Valid assuming 6-digit format CYYDDD or similar where first digit is the subplant
            const min = parseInt(subLine) * 100000;
            const max = (parseInt(subLine) + 1) * 100000;

            sql += ` AND B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd`;
            binds.subLineStart = min;
            binds.subLineEnd = max;
        }

        if (startDateStr && endDateStr) {
            const start = new Date(startDateStr);
            const end = new Date(endDateStr);

            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                const startYY = start.getFullYear() - 2000;
                const startDDD = getDayOfYear(start);
                const startJdeSuffix = (startYY * 1000) + startDDD;

                const endYY = end.getFullYear() - 2000;
                const endDDD = getDayOfYear(end);
                const endJdeSuffix = (endYY * 1000) + endDDD;

                // Filter on Task Date (TO55TAREA)
                sql += ` AND MOD(B.TO55TAREA, 100000) >= :startJde AND MOD(B.TO55TAREA, 100000) <= :endJde`;
                binds.startJde = startJdeSuffix;
                binds.endJde = endJdeSuffix;
            }
        }

        if (searchParams.get('article')) {
            const article = searchParams.get('article');

            // Control de seguridad: Validar que sea estrictamente numérico y de 10 dígitos
            // Esto previene inyección y asegura el formato correcto (0000000000 - 9999999999)
            if (!article || !/^\d{10}$/.test(article)) {
                return NextResponse.json(
                    { error: 'Formato inválido: El artículo debe contener exactamente 10 números.' },
                    { status: 400 }
                );
            }

            sql += ` AND TRIM(A.WAAITM) = :article`;
            binds.article = article;
        }

        // Pagination
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '150');
        const offset = (page - 1) * limit;

        // Order by Task Date
        sql += ` ORDER BY B.TO55TAREA DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

        const result = await conn.execute(sql, binds);

        const rows = result.rows as any[];

        // Transform Data
        const data = rows.map((row: any) => {
            const plantStr = row.WAMCU != null ? String(row.WAMCU).trim() : undefined;
            // Use TO55TAREA for Date/Subline Logic
            const jdeParsed = parseJdeDate(row.TO55TAREA, plantStr);
            return {
                order: row.WADOCO != null ? String(row.WADOCO).trim() : '',
                date: jdeParsed ? jdeParsed.date : null,
                productionDateRaw: row.TO55TAREA,
                description: row.WADL01 != null ? String(row.WADL01).trim() : '',
                quantity: parseWasOqs(row.WASOQS),
                unit: row.TOUM != null ? String(row.TOUM).trim() : '',
                plantCode: row.WAMCU != null ? String(row.WAMCU).trim() : '',
                article: row.WAAITM != null ? String(row.WAAITM).trim() : '',
                subLine: jdeParsed?.subBlockName || 'Desconocido',
                subLineCode: jdeParsed?.subBlock
            };
        });

        return NextResponse.json(data);
    } catch (err: any) {
        console.error("Database Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
