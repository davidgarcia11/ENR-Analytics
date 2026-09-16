import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { parseLoteadoraInput } from '../route';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { id } = await params;
  const loteadoraId = Number(id);
  const body = await req.json();
  const parsed = parseLoteadoraInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, ip, port, slaveAddress, enabled, linea } = parsed.value;

  const db = getDb();

  const existing = db.prepare('SELECT id FROM loteadoras WHERE name = ? AND id != ?').get(name, loteadoraId);
  if (existing) {
    return NextResponse.json({ error: 'Ya existe otra loteadora con ese nombre' }, { status: 409 });
  }

  const result = db.prepare(
    `UPDATE loteadoras SET name = ?, ip = ?, port = ?, slave_address = ?, enabled = ?, linea = ?
     WHERE id = ?`
  ).run(name, ip, port, slaveAddress, enabled, linea, loteadoraId);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Loteadora no encontrada' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadoras WHERE id = ?').run(Number(id));

  return NextResponse.json({ ok: true });
}
