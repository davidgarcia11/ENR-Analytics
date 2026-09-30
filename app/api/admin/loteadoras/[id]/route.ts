import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { parseLoteadoraInput } from '../route';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: L('maquinas', 'editar') });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const loteadoraId = Number(id);
  const body = await req.json();
  const parsed = parseLoteadoraInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, ip, port, slaveAddress, enabled, linea, familias, zonaId } = parsed.value;

  const db = getDb();
  if (zonaId !== null && !db.prepare('SELECT 1 FROM zonas WHERE id = ?').get(zonaId)) {
    return NextResponse.json({ error: 'La zona no existe' }, { status: 400 });
  }

  const existing = db.prepare('SELECT id FROM loteadoras WHERE name = ? AND id != ?').get(name, loteadoraId);
  if (existing) {
    return NextResponse.json({ error: 'Ya existe otra loteadora con ese nombre' }, { status: 409 });
  }

  const result = db.prepare(
    `UPDATE loteadoras SET name = ?, ip = ?, port = ?, slave_address = ?, enabled = ?, linea = ?, familias = ?, zona_id = ?
     WHERE id = ?`
  ).run(name, ip, port, slaveAddress, enabled, linea, familias, zonaId, loteadoraId);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Loteadora no encontrada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: L('maquinas', 'eliminar') });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadoras WHERE id = ?').run(Number(id));

  return NextResponse.json({ ok: true });
}
