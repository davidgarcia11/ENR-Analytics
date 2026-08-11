import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from '@/lib/utils';
import { parseJdeDate } from '@/lib/utils';

// Cabeceras CORS para permitir llamadas desde artefactos externos (ej. Claude artifacts)
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key',
};

// Preflight CORS
export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
    // Autenticación por API key (header x-api-key)
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey || apiKey !== process.env.SERES_API_KEY) {
        return NextResponse.json(
            { error: 'No autorizado' },
            { status: 401, headers: CORS_HEADERS }
        );
    }

    const { searchParams } = new URL(req.url);
    // Máximo 90 días para no sobrecargar la consulta
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 90);

    // Convertir fecha límite a formato JDE (CYYDDD): 1 * 100000 + YY * 1000 + DDD
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceYY = since.getFullYear() - 2000;
    const sinceDDD = getDayOfYear(since);
    const sinceJde = 100000 + sinceYY * 1000 + sinceDDD;

    let conn;
    try {
        conn = await getDbConnection();

        const result = await conn.execute(
            `SELECT TRIM(SYVR01) AS REFERENCIA, SYUPMJ AS FECHA_JDE
             FROM F47011
             WHERE SYUPMJ >= :fechaDesde
               AND TRIM(SYVR01) IS NOT NULL
             ORDER BY SYUPMJ DESC`,
            { fechaDesde: sinceJde }
        );

        const rows = (result.rows as any[]).map(row => {
            const parsed = parseJdeDate(row.FECHA_JDE);
            return {
                referencia: String(row.REFERENCIA).trim(),
                fecha: parsed ? parsed.date.toISOString().split('T')[0] : null,
            };
        });

        return NextResponse.json(rows, { headers: CORS_HEADERS });

    } catch (err: any) {
        console.error('Error /api/jde-orders:', err);
        return NextResponse.json(
            { error: err.message },
            { status: 500, headers: CORS_HEADERS }
        );
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
