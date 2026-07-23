import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { sendRemoteFields } from '@/lib/loteadora-printer';

// Envía lote y fecha de caducidad a una loteadora física por TCP (comando 1D
// del protocolo TIJ). A diferencia de marcas/articulos, este endpoint sí
// exige sesión: dispara una acción física real (imprime una etiqueta).
export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { loteadoraId, lote, fechaCaducidad } = await req.json();

  if (!loteadoraId || !lote || !fechaCaducidad) {
    return NextResponse.json({ error: 'Faltan datos: loteadoraId, lote y fechaCaducidad son obligatorios' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address, lot_field_id, expiry_field_id FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as
    | { ip: string; port: number; slave_address: number; lot_field_id: number; expiry_field_id: number }
    | undefined;

  if (!loteadora) {
    return NextResponse.json({ error: 'Loteadora no encontrada o deshabilitada' }, { status: 404 });
  }

  try {
    await sendRemoteFields(
      { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address },
      [
        { id: loteadora.lot_field_id, text: String(lote) },
        { id: loteadora.expiry_field_id, text: String(fechaCaducidad) },
      ]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Envío a loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
