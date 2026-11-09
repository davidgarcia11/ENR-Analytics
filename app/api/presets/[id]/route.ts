import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ sesion: true });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

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

// Marca (o desmarca) un preset como predeterminado: el que se aplica al abrir el panel.
// Solo hay uno por usuario y panel, así que marcar uno desmarca el resto.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ sesion: true });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.predeterminado !== 'boolean') {
    return NextResponse.json({ error: 'predeterminado debe ser true o false' }, { status: 400 });
  }

  const db = getDb();
  const preset = db.prepare('SELECT screen FROM presets WHERE id = ? AND user_id = ?').get(Number(id), user.id) as { screen: string } | undefined;
  if (!preset) {
    return NextResponse.json({ error: 'Preset no encontrado' }, { status: 404 });
  }

  db.transaction(() => {
    db.prepare('UPDATE presets SET es_predeterminado = 0 WHERE user_id = ? AND screen = ?').run(user.id, preset.screen);
    if (body.predeterminado) {
      db.prepare('UPDATE presets SET es_predeterminado = 1 WHERE id = ? AND user_id = ?').run(Number(id), user.id);
    }
  })();

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ sesion: true });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

  const { id } = await params;
  const db = getDb();
  // Solo puede borrar sus propios presets
  db.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(Number(id), user.id);

  return NextResponse.json({ ok: true });
}
