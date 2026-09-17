import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { parseMensajeInput } from '../route';
import { requireAccess } from '@/lib/permissions';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const mensajeId = Number(id);
  const body = await req.json();
  const parsed = parseMensajeInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId } = parsed.value;

  const db = getDb();

  const existing = db.prepare('SELECT id FROM loteadora_mensajes WHERE name = ? AND id != ?').get(name, mensajeId);
  if (existing) {
    return NextResponse.json({ error: 'Ya existe otra plantilla con ese nombre' }, { status: 409 });
  }

  const result = db.prepare(
    `UPDATE loteadora_mensajes SET name = ?, lot_field_id = ?, cocida_field_id = ?, expiry_field_id = ?, hora_field_id = ?, turno_field_id = ?, linea_field_id = ?
     WHERE id = ?`
  ).run(name, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId, mensajeId);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadora_mensajes WHERE id = ?').run(Number(id));

  return NextResponse.json({ ok: true });
}
