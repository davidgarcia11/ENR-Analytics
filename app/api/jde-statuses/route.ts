import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

// GET /api/jde-statuses
// Devuelve las descripciones editables de los códigos SYEDSP de JDE.
// Las consume /comparativa-seres para enriquecer el badge, la columna
// "Descripción" y el export Excel. Requiere sesión (no debe ser público
// para evitar exponer info interna a terceros).
export async function GET() {
    const user = await verifySession();
    if (!user) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    try {
        const db = getDb();
        const rows = db
            .prepare('SELECT code, description FROM jde_status_descriptions ORDER BY code')
            .all() as { code: string; description: string }[];
        return NextResponse.json(rows);
    } catch (err: any) {
        console.error('Error GET /api/jde-statuses:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
