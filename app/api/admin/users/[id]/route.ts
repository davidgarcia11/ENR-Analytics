import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession, hashPassword } from '@/lib/auth';

// PUT: editar datos de un usuario (solo admin)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  const { username, name, surname, role } = await req.json();

  if (!username || !username.trim()) {
    return NextResponse.json({ error: 'El usuario es obligatorio' }, { status: 400 });
  }

  const db = getDb();

  // Verificar que el username no esté en uso por otro usuario
  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), userId) as any;
  if (existing) {
    return NextResponse.json({ error: 'Ya existe otro usuario con ese nombre de usuario' }, { status: 409 });
  }

  const userRole = role === 'admin' ? 'admin' : 'user';
  db.prepare('UPDATE users SET username = ?, name = ?, surname = ?, role = ? WHERE id = ?')
    .run(username.trim(), name || '', surname || '', userRole, userId);

  return NextResponse.json({ ok: true });
}

// PATCH: resetear contraseña de un usuario (solo admin)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { id } = await params;
  const { password } = await req.json();

  if (!password || password.length < 4) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 4 caracteres' }, { status: 400 });
  }

  const db = getDb();
  const hash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, Number(id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);

  if (userId === user.id) {
    return NextResponse.json({ error: 'No puedes eliminarte a ti mismo' }, { status: 400 });
  }

  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  return NextResponse.json({ ok: true });
}
