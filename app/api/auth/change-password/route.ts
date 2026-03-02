import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession, hashPassword, createToken, COOKIE_NAME, cookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { password } = await req.json();

  if (!password || password.length < 4) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 4 caracteres' }, { status: 400 });
  }

  const db = getDb();
  const hash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);

  // Regenerar token con datos actualizados
  const token = await createToken({ id: user.id, username: user.username, role: user.role });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, cookieOptions(req));

  return res;
}
