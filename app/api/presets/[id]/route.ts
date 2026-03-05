import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { id } = await params;
  const { name, filters } = await req.json();

  if (!name || !filters) {
    return NextResponse.json({ error: 'Nombre y filtros son obligatorios' }, { status: 400 });
  }

  const db = getDb();

  // Verificar que el preset pertenece al usuario
  const existing = db.prepare('SELECT id FROM presets WHERE id = ? AND user_id = ?').get(Number(id), user.id);
  if (!existing) {
    return NextResponse.json({ error: 'Preset no encontrado' }, { status: 404 });
  }

  // Verificar que no hay otro preset con el mismo nombre (excluyendo el actual)
  const duplicate = db.prepare('SELECT id FROM presets WHERE user_id = ? AND name = ? AND id != ?').get(user.id, name, Number(id));
  if (duplicate) {
    return NextResponse.json({ error: 'Ya tienes un preset con ese nombre' }, { status: 409 });
  }

  db.prepare('UPDATE presets SET name = ?, filters = ? WHERE id = ? AND user_id = ?')
    .run(name, JSON.stringify(filters), Number(id), user.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  // Solo puede borrar sus propios presets
  db.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(Number(id), user.id);

  return NextResponse.json({ ok: true });
}
