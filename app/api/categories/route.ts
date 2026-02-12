import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';

// Mapa de campos permitidos: clave usada en la URL -> columna F4101, DRSY y DRRT de F0005
// directF0005: si true, consulta F0005 directamente en vez de pasar por F4101
//   (necesario cuando DRKY tiene padding CHAR diferente al campo de F4101)
const FIELD_MAP: Record<string, { col: string; drsy: string; drrt: string; directF0005?: boolean }> = {
    prp6: { col: 'IMPRP6', drsy: '41', drrt: '01' },
    srp3: { col: 'IMPRP6', drsy: '41', drrt: 'S3', directF0005: true },
    srp5: { col: 'IMSRP5', drsy: '41', drrt: 'S5', directF0005: true },
    srp2: { col: 'IMSRP2', drsy: '41', drrt: 'S2', directF0005: true },
    srp1: { col: 'IMSRP1', drsy: '41', drrt: 'S1', directF0005: true },
    srp4: { col: 'IMSRP4', drsy: '41', drrt: 'S4', directF0005: true },
};

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const field = searchParams.get('field');

    if (!field || !FIELD_MAP[field]) {
        return NextResponse.json({ error: 'Campo no válido' }, { status: 400 });
    }

    const { col, drsy, drrt, directF0005 } = FIELD_MAP[field];

    let conn;
    try {
        conn = await getDbConnection();

        let sql: string;

        if (directF0005) {
            // Consulta directa a F0005: saca todos los códigos y descripciones
            // filtrados por DRSY/DRRT. Necesario cuando DRKY tiene padding CHAR
            // que dificulta el JOIN con F4101.
            sql = `
                SELECT TRIM(F.DRKY) as CATID, TRIM(F.DRDL01) as CATDESC
                FROM prodctl.f0005 F
                WHERE TRIM(F.DRSY) = '${drsy}'
                  AND TRIM(F.DRRT) = '${drrt}'
                  AND TRIM(F.DRKY) IS NOT NULL
                ORDER BY TRIM(F.DRKY)
            `;
        } else {
            // Obtenemos los códigos de F4101 (artículos reales) y los cruzamos con F0005 para la descripción.
            // Así el desplegable solo muestra valores en uso, no todos los posibles de F0005.
            // TRIM en DRKY es necesario porque JDE almacena CHAR con espacios de relleno.
            // Embebemos DRSY/DRRT directamente en el SQL (valores del FIELD_MAP, no del usuario)
            // para evitar problemas de comparación CHAR vs VARCHAR2 con bind variables en oracledb
            sql = `
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
        }

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
