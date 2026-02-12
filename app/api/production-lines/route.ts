import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';

// Endpoint para obtener las líneas de producción disponibles
// F30006 (Work Center) filtrado por IWAPSC >= '1' + F0006 (Business Unit) para la descripción
export async function GET(req: NextRequest) {
    let conn;
    try {
        conn = await getDbConnection();

        const sql = `
            SELECT TRIM(A.IWMCU) as LINE_ID, TRIM(B.MCDL01) as LINE_DESC
            FROM F30006 A
            LEFT JOIN F0006 B ON B.MCMCU = A.IWMCU
            WHERE A.IWAPSC >= '1'
            GROUP BY TRIM(A.IWMCU), TRIM(B.MCDL01)
            ORDER BY TRIM(A.IWMCU)
        `;

        const result = await conn.execute(sql);
        const rows = (result.rows as any[]).map(r => ({
            id: String(r.LINE_ID || '').trim(),
            description: String(r.LINE_DESC || '').trim(),
        })).filter(r => r.id);

        // Añadimos opción "Sin línea" al inicio para filtrar registros con ILMCUZ vacío
        rows.unshift({ id: '__empty__', description: 'Sin línea' });

        return NextResponse.json(rows);

    } catch (err: any) {
        console.error('Production Lines Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
