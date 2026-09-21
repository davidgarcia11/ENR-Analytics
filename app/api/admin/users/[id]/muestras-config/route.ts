import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

// Activa/desactiva el permiso suelto can_configure_muestras de un usuario — endpoint
// propio (no el PUT general de edición) para poder alternarlo con un solo clic desde
// la tabla de /admin, sin entrar en modo edición.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const { enabled } = await req.json();

  const db = getDb();
  db.prepare('UPDATE users SET can_configure_muestras = ? WHERE id = ?').run(enabled ? 1 : 0, Number(id));

  return NextResponse.json({ ok: true });
}
