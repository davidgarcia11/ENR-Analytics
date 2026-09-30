import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';
import { guardarCampos, validarPlantilla } from '@/lib/loteadora-plantilla';

// Edita nombre y campos de una plantilla (los campos se sustituyen enteros).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: L('plantillas', 'editar') });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const mensajeId = Number(id);
  const parsed = validarPlantilla(await req.json());
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, campos } = parsed.value;

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM loteadora_mensajes WHERE id = ?').get(mensajeId)) {
    return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  }
  if (db.prepare('SELECT 1 FROM loteadora_mensajes WHERE name = ? AND id != ?').get(name, mensajeId)) {
    return NextResponse.json({ error: 'Ya existe otra plantilla con ese nombre' }, { status: 409 });
  }

  db.transaction(() => {
    db.prepare('UPDATE loteadora_mensajes SET name = ? WHERE id = ?').run(name, mensajeId);
    guardarCampos(db, mensajeId, campos);
  })();

  return NextResponse.json({ ok: true });
}

// Borra la plantilla; sus campos y las asociaciones de artículos caen en cascada.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: L('plantillas', 'eliminar') });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadora_mensajes WHERE id = ?').run(Number(id));

  return NextResponse.json({ ok: true });
}
