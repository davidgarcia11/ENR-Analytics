import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifyPassword, createToken, COOKIE_NAME, cookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'Usuario y contraseña requeridos' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, password_hash, role, must_change_password, name, surname FROM users WHERE username = ?').get(username) as any;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
    }

    const token = await createToken({ id: user.id, username: user.username, role: user.role, name: user.name || '', surname: user.surname || '' });

    // Registrar login en logs
    try {
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user.id, user.username, 'login', JSON.stringify({ action: 'login' }), null, null);
    } catch (logErr) {
      console.error('Error logging login:', logErr);
    }

    const res = NextResponse.json({ ok: true, username: user.username, role: user.role, mustChangePassword: !!user.must_change_password });
    res.cookies.set(COOKIE_NAME, token, cookieOptions(req));

    return res;
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
