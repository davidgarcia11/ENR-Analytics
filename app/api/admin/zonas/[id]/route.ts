import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { guardarAsignaciones, parseZonaInput } from '../route';

// Renombra una zona y sustituye sus roles y usuarios. Solo admin.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const zonaId = Number((await params).id);
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM zonas WHERE id = ?').get(zonaId)) {
    return NextResponse.json({ error: 'Zona no encontrada' }, { status: 404 });
  }
  const parsed = parseZonaInput(db, await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (db.prepare('SELECT 1 FROM zonas WHERE nombre = ? AND id != ?').get(parsed.value.nombre, zonaId)) {
    return NextResponse.json({ error: 'Ya existe otra zona con ese nombre' }, { status: 409 });
  }
  db.transaction(() => {
    db.prepare('UPDATE zonas SET nombre = ? WHERE id = ?').run(parsed.value.nombre, zonaId);
    guardarAsignaciones(db, zonaId, parsed.value);
  })();
  return NextResponse.json({ ok: true });
}

// Borra la zona: sus loteadoras se quedan sin zona (ON DELETE SET NULL) y se
// quitan sus asignaciones a roles y usuarios (ON DELETE CASCADE).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const zonaId = Number((await params).id);
  const db = getDb();
  const r = db.prepare('DELETE FROM zonas WHERE id = ?').run(zonaId);
  if (r.changes === 0) return NextResponse.json({ error: 'Zona no encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
