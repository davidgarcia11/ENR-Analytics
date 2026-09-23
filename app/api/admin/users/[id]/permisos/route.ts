import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { esPermiso } from '@/lib/permisos';

// Activa/desactiva UN permiso suelto (catálogo en lib/permisos.ts) de un usuario —
// endpoint propio (no el PUT general de edición) para poder alternarlo con un solo
// clic desde la tabla de /admin → Usuarios, sin entrar en modo edición.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const { permiso, enabled } = await req.json();

  if (!esPermiso(permiso)) {
    return NextResponse.json({ error: 'Permiso desconocido' }, { status: 400 });
  }

  const db = getDb();
  const userId = Number(id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
  }

  if (enabled) {
    db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)').run(userId, permiso);
  } else {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?').run(userId, permiso);
  }

  return NextResponse.json({ ok: true });
}
