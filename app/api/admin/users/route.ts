import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { hashPassword } from '@/lib/auth';
import { PLANTS } from '@/lib/plants';
import { requireAccess } from '@/lib/permissions';

export async function GET() {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const users = db.prepare('SELECT id, username, role, name, surname, default_plant AS defaultPlant, can_configure_muestras AS canConfigureMuestras, created_at FROM users ORDER BY id').all();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

  try {
    const { username, password, role, mustChangePassword, name, surname, defaultPlant } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
    }

    const hash = hashPassword(password);
    const forceChange = mustChangePassword ? 1 : 0;
    const db = getDb();
    const validRole = db.prepare('SELECT name FROM roles WHERE name = ?').get(role) as { name: string } | undefined;
    const userRole = validRole ? role : 'user';
    const userDefaultPlant = PLANTS.some(p => p.id === defaultPlant) ? defaultPlant : '';

    try {
      db.prepare('INSERT INTO users (username, password_hash, role, must_change_password, name, surname, default_plant) VALUES (?, ?, ?, ?, ?, ?, ?)').run(username, hash, userRole, forceChange, name || '', surname || '', userDefaultPlant);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return NextResponse.json({ error: 'El usuario ya existe' }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Create user error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
