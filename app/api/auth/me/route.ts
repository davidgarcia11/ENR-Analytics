import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDb } from '@/lib/sqlite';

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
  });
}
