import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { getPrinterStatus } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  id: number;
  name: string;
  ip: string;
  port: number;
  slave_address: number;
}

// Estado en vivo (público) de las loteadoras habilitadas, para el listado
// de /loteadora. No expone ip/puerto/slave — cada consulta abre y cierra
// una conexión TCP breve (protocolo TIJ, comando 14).
export async function GET() {
  const db = getDb();
  const loteadoras = db.prepare(
    'SELECT id, name, ip, port, slave_address FROM loteadoras WHERE enabled = 1 ORDER BY name'
  ).all() as LoteadoraRow[];

  const estados = await Promise.all(
    loteadoras.map(async (l) => ({
      id: l.id,
      name: l.name,
      state: await getPrinterStatus({ ip: l.ip, port: l.port, slaveAddress: l.slave_address }),
    }))
  );

  return NextResponse.json(estados);
}
