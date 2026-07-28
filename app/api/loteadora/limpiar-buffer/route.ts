import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { clearRemoteFieldBuffer } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
}

// Vacía la cola de campos remotos pendientes de una loteadora (comando 21).
// No imprime nada — solo descarta envíos en cola que no se hayan consumido.
export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { loteadoraId } = await req.json();
  if (!loteadoraId) {
    return NextResponse.json({ error: 'Falta loteadoraId' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as LoteadoraRow | undefined;

  if (!loteadora) {
    return NextResponse.json({ error: 'Loteadora no encontrada o deshabilitada' }, { status: 404 });
  }

  try {
    await clearRemoteFieldBuffer({ ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Limpiar buffer de loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
