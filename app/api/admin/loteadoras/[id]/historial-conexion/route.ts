import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';
import { historialCsv } from '@/lib/loteadora-ping';

// Historial de conexión (ping) de una loteadora, en CSV: /admin → Máquinas →
// "Historial de conexión". Ver lib/loteadora-ping.ts.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: L('maquinas') });
  if (!acceso.ok) return acceso.denied;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Loteadora no válida' }, { status: 400 });
  const db = getDb();
  const l = db.prepare('SELECT name FROM loteadoras WHERE id = ?').get(id) as { name: string } | undefined;
  const nombre = (l?.name ?? `loteadora-${id}`).replace(/[^A-Za-z0-9_-]+/g, '_');
  return new NextResponse(historialCsv(db, id), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="conexion-${nombre}.csv"`,
    },
  });
}
