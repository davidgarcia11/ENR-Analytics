import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { listMessageNames } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
  message_name: string;
}

// Lista las plantillas guardadas en una loteadora (comando 1F), para el
// desplegable de /loteadora. Requiere sesión, igual que /enviar.
export async function GET(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const loteadoraId = Number(req.nextUrl.searchParams.get('loteadoraId'));
  if (!loteadoraId) {
    return NextResponse.json({ error: 'Falta loteadoraId' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address, message_name FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(loteadoraId) as LoteadoraRow | undefined;

  if (!loteadora) {
    return NextResponse.json({ error: 'Loteadora no encontrada o deshabilitada' }, { status: 404 });
  }

  try {
    const messages = await listMessageNames({ ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address });
    return NextResponse.json({ messages, current: loteadora.message_name });
  } catch (err: any) {
    console.error('Listar plantillas de loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
