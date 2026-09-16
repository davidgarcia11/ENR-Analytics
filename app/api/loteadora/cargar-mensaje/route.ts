import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireScreenAccess } from '@/lib/permissions';
import { loadPrintMessage } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
}

// Carga una plantilla existente en la loteadora (comandos 1E + 01). No se
// comprueba el estado de impresión: el protocolo exige la impresión iniciada
// para aceptar 1F/1E (P_Status=12 si no), y en el firmware T1/T2 de esta
// máquina está explícitamente permitido actualizar el contenido con la
// impresión iniciada — no hace falta pararla (ver docs/loteadora.md §11).
export async function POST(req: NextRequest) {
  const denied = await requireScreenAccess('loteadora');
  if (denied) return denied;

  const { loteadoraId, messageName } = await req.json();
  if (!loteadoraId || !messageName) {
    return NextResponse.json({ error: 'Faltan datos: loteadoraId y messageName son obligatorios' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as LoteadoraRow | undefined;

  if (!loteadora) {
    return NextResponse.json({ error: 'Loteadora no encontrada o deshabilitada' }, { status: 404 });
  }

  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  try {
    await loadPrintMessage(config, String(messageName));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Cargar plantilla en loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
