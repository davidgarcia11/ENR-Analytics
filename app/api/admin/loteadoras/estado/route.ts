import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { getPrinterStatus } from '@/lib/loteadora-printer';
import { requireAccess } from '@/lib/permissions';

interface LoteadoraRow {
  id: number;
  ip: string;
  port: number;
  slave_address: number;
}

// Estado en vivo (admin) de TODAS las loteadoras, habilitadas o no, para la
// pestaña Loteadoras de /admin.
export async function GET() {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.maquinas' });
  if (!acceso.ok) return acceso.denied;

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
