import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

// Valida y normaliza el body de alta/edición de un mensaje (plantilla).
export function parseMensajeInput(body: any) {
  const name = String(body.name ?? '').trim();
  const lotFieldId = Number(body.lotFieldId);
  const cocidaFieldId = Number(body.cocidaFieldId);
  const expiryFieldId = Number(body.expiryFieldId);
  const horaFieldId = Number(body.horaFieldId);
  const turnoFieldId = Number(body.turnoFieldId);
  const lineaFieldId = Number(body.lineaFieldId);

  if (!name) return { error: 'El nombre es obligatorio' };

  for (const [label, value] of [
    ['ID de campo del lote', lotFieldId],
    ['ID de campo de la cocida', cocidaFieldId],
    ['ID de campo de la caducidad', expiryFieldId],
    ['ID de campo de la hora', horaFieldId],
    ['ID de campo del turno', turnoFieldId],
    ['ID de campo de la línea', lineaFieldId],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return { error: `${label} debe ser un entero entre 0 y 255` };
    }
  }

  if (new Set([lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId]).size !== 6) {
    return { error: 'Los IDs de campo de lote, cocida, caducidad, hora, turno y línea deben ser distintos entre sí' };
  }

  return { value: { name, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId } };
}

// Lectura abierta también a quien asigna artículos a plantillas (necesita el
// desplegable); crear/editar/borrar siguen siendo solo de admin.
export async function GET() {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.articulos' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const mensajes = db.prepare(
    'SELECT id, name, lot_field_id, cocida_field_id, expiry_field_id, hora_field_id, turno_field_id, linea_field_id, created_at FROM loteadora_mensajes ORDER BY name'
  ).all();
  return NextResponse.json(mensajes);
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json();
  const parsed = parseMensajeInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId } = parsed.value;

  const db = getDb();
  try {
    const result = db.prepare(
      `INSERT INTO loteadora_mensajes (name, lot_field_id, cocida_field_id, expiry_field_id, hora_field_id, turno_field_id, linea_field_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(name, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId);
    const created = db.prepare('SELECT id, name, lot_field_id, cocida_field_id, expiry_field_id, hora_field_id, turno_field_id, linea_field_id, created_at FROM loteadora_mensajes WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Ya existe una plantilla con ese nombre' }, { status: 409 });
    }
    console.error('Create loteadora_mensaje error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
