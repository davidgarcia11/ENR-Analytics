import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const { is_public, allowed_roles } = await req.json() as { is_public: boolean; allowed_roles: string[] };

  const db = getDb();
  const screen = db.prepare('SELECT id, key FROM screens WHERE key = ?').get(key) as { id: number; key: string } | undefined;
  if (!screen) {
    return NextResponse.json({ error: 'Pantalla no encontrada' }, { status: 404 });
  }

  // La pantalla admin solo puede ser configurada por el propio sistema (siempre restringida)
  if (screen.key === 'admin') {
    return NextResponse.json({ error: 'La pantalla admin no se puede modificar' }, { status: 400 });
  }

  db.prepare('UPDATE screens SET is_public = ? WHERE id = ?').run(is_public ? 1 : 0, screen.id);

  // Reemplazar permisos de roles
  db.prepare('DELETE FROM screen_permissions WHERE screen_id = ?').run(screen.id);
  if (!is_public && Array.isArray(allowed_roles) && allowed_roles.length > 0) {
    const insertPerm = db.prepare(`
      INSERT OR IGNORE INTO screen_permissions (screen_id, role_id)
      SELECT ?, id FROM roles WHERE name = ?
    `);
    for (const roleName of allowed_roles) {
      insertPerm.run(screen.id, roleName);
    }
  }

  // Siempre asegurar que admin tiene acceso a todo
  db.prepare(`
    INSERT OR IGNORE INTO screen_permissions (screen_id, role_id)
    SELECT ?, id FROM roles WHERE name = 'admin'
  `).run(screen.id);

  return NextResponse.json({ ok: true });
}
