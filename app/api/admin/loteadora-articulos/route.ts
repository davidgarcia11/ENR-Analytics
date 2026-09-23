import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

// Lista las asociaciones artículo -> plantilla (solo SQLite; la descripción
// del artículo se resuelve en el front cruzando con GET /api/loteadora/articulos,
// para no duplicar aquí una consulta a Oracle).
export async function GET() {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.articulos' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const asociaciones = db.prepare(
    `SELECT am.articulo_id, am.mensaje_id, m.name AS mensaje_name, am.created_at
     FROM loteadora_articulo_mensajes am
     JOIN loteadora_mensajes m ON m.id = am.mensaje_id
     ORDER BY am.articulo_id`
  ).all();
  return NextResponse.json(asociaciones);
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.articulos' });
  if (!acceso.ok) return acceso.denied;

  const { articuloId, mensajeId } = await req.json();
  const cleanArticuloId = String(articuloId ?? '').trim();

  if (!/^\d{10}$/.test(cleanArticuloId)) {
    return NextResponse.json({ error: 'El artículo debe tener exactamente 10 dígitos' }, { status: 400 });
  }
  if (!Number.isInteger(Number(mensajeId))) {
    return NextResponse.json({ error: 'Falta la plantilla a asociar' }, { status: 400 });
  }

  const db = getDb();
  const mensaje = db.prepare('SELECT id FROM loteadora_mensajes WHERE id = ?').get(Number(mensajeId));
  if (!mensaje) {
    return NextResponse.json({ error: 'La plantilla indicada no existe' }, { status: 404 });
  }

  db.prepare(
    `INSERT INTO loteadora_articulo_mensajes (articulo_id, mensaje_id) VALUES (?, ?)
     ON CONFLICT(articulo_id) DO UPDATE SET mensaje_id = excluded.mensaje_id`
  ).run(cleanArticuloId, Number(mensajeId));

  return NextResponse.json({ ok: true }, { status: 201 });
}
