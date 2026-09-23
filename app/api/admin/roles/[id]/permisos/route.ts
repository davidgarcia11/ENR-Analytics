import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAdmin } from '@/lib/permissions';
import { esPermiso } from '@/lib/permisos';

// Activa/desactiva UN permiso de configuración (catálogo en lib/permisos.ts) para un
// rol — la matriz "Roles y permisos" de /admin guarda cada casilla al marcarla.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const { permiso, enabled } = await req.json();

  if (!esPermiso(permiso)) {
    return NextResponse.json({ error: 'Permiso desconocido' }, { status: 400 });
  }

  const db = getDb();
  const roleId = Number(id);
  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
  if (!role) {
    return NextResponse.json({ error: 'Rol no encontrado' }, { status: 404 });
  }
  if (role.name === 'admin') {
    return NextResponse.json({ error: 'El rol admin tiene todos los permisos' }, { status: 400 });
  }

  if (enabled) {
    db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)').run(roleId, permiso);
  } else {
    db.prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission = ?').run(roleId, permiso);
  }

  return NextResponse.json({ ok: true });
}
