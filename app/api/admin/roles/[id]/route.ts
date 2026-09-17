import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAdmin } from '@/lib/permissions';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const db = getDb();

  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(Number(id)) as { name: string } | undefined;
  if (!role) {
    return NextResponse.json({ error: 'Rol no encontrado' }, { status: 404 });
  }
  if (role.name === 'admin') {
    return NextResponse.json({ error: 'El rol admin no se puede eliminar' }, { status: 400 });
  }

  // Reasignar usuarios de este rol a 'user' antes de borrar
  db.prepare("UPDATE users SET role = 'user' WHERE role = ?").run(role.name);
  db.prepare('DELETE FROM roles WHERE id = ?').run(Number(id));

  return NextResponse.json({ ok: true });
}
