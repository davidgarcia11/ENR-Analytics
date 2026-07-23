import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getPrinterStatus } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  id: number;
  ip: string;
  port: number;
  slave_address: number;
}

// Estado en vivo (admin) de TODAS las loteadoras, habilitadas o no, para la
// pestaña Loteadoras de /admin.
export async function GET() {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const db = getDb();
  const loteadoras = db.prepare('SELECT id, ip, port, slave_address FROM loteadoras').all() as LoteadoraRow[];

  const estados = await Promise.all(
    loteadoras.map(async (l) => ({
      id: l.id,
      state: await getPrinterStatus({ ip: l.ip, port: l.port, slaveAddress: l.slave_address }),
    }))
  );

  return NextResponse.json(estados);
}
