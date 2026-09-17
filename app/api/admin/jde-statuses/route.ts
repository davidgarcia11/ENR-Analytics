import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAdmin } from '@/lib/permissions';

// GET /api/admin/jde-statuses
// Igual que /api/jde-statuses pero pensado para la UI admin (mismo dato,
// pasa por el middleware de /api/admin/* que ya valida rol admin).
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

    try {
        const db = getDb();
        const rows = db
            .prepare('SELECT code, description, updated_at FROM jde_status_descriptions ORDER BY code')
            .all() as { code: string; description: string; updated_at: string }[];
        return NextResponse.json(rows);
    } catch (err: any) {
        console.error('Error GET /api/admin/jde-statuses:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
