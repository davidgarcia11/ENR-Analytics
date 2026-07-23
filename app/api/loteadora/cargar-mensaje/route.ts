import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getPrinterStatus, loadPrintMessage } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
}

// Carga una plantilla existente en la loteadora (comandos 1E + 01). Antes de
// intentarlo, comprueba que la impresora no esté imprimiendo — cambiar de
// plantilla en remoto mientras imprime interrumpiría un trabajo real.
export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

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

  const estado = await getPrinterStatus(config);
  if (estado === 'activa') {
    return NextResponse.json(
      { error: 'La loteadora está imprimiendo. Detén la impresión en la pantalla de la máquina antes de cambiar de plantilla.' },
      { status: 409 }
    );
  }

  try {
    await loadPrintMessage(config, String(messageName));
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Cargar plantilla en loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
