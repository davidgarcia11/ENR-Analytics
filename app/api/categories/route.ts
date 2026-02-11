import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';

// Mapa de campos permitidos: clave usada en la URL -> columna F4101, DRSY y DRRT de F0005
const FIELD_MAP: Record<string, { col: string; drsy: string; drrt: string }> = {
    prp6: { col: 'IMPRP6', drsy: '41', drrt: '01' },
};

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const field = searchParams.get('field');

    if (!field || !FIELD_MAP[field]) {
        return NextResponse.json({ error: 'Campo no válido' }, { status: 400 });
    }

    const { col, drsy, drrt } = FIELD_MAP[field];

    let conn;
    try {
        conn = await getDbConnection();

        // Obtenemos los códigos de F4101 (artículos reales) y los cruzamos con F0005 para la descripción.
        // Así el desplegable solo muestra valores en uso, no todos los posibles de F0005.
        // TRIM en DRKY es necesario porque JDE almacena CHAR con espacios de relleno.
        // Embebemos DRSY/DRRT directamente en el SQL (valores del FIELD_MAP, no del usuario)
        // para evitar problemas de comparación CHAR vs VARCHAR2 con bind variables en oracledb
        const sql = `
            SELECT TRIM(D.${col}) as CATID, MAX(TRIM(F.DRDL01)) as CATDESC
            FROM F4101 D
            LEFT JOIN prodctl.f0005 F
                ON TRIM(F.DRKY) = TRIM(D.${col})
               AND TRIM(F.DRSY) = '${drsy}'
               AND TRIM(F.DRRT) = '${drrt}'
            WHERE TRIM(D.${col}) IS NOT NULL
            GROUP BY TRIM(D.${col})
            ORDER BY TRIM(D.${col})
        `;

        const result = await conn.execute(sql);
        const rows = (result.rows as any[]).map(r => ({
            id: String(r.CATID || '').trim(),
            description: String(r.CATDESC || '').trim(),
        })).filter(r => r.id);

        return NextResponse.json(rows);

    } catch (err: any) {
        console.error('Categories Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}
