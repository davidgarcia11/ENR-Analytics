import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDb } from '@/lib/sqlite';
import { permisosDeUsuario } from '@/lib/permissions';

export async function GET() {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const db = getDb();
  const dbUser = db.prepare('SELECT must_change_password, name, surname, default_plant FROM users WHERE id = ?').get(user.id) as any;

  return NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
    name: dbUser?.name || '',
    surname: dbUser?.surname || '',
    mustChangePassword: !!(dbUser?.must_change_password),
    defaultPlant: dbUser?.default_plant || '',
    // Efectivos (los de su rol + sus extras); el admin los tiene todos implícitamente (lib/permisos.ts, tienePermiso)
    permisos: permisosDeUsuario(user.id, user.role),
  });
}
