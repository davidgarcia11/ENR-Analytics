import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { sendRemoteFields, getPrinterStatusDetail } from '@/lib/loteadora-printer';

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

  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  try {
    const { warning } = await sendRemoteFields(config, [
      { id: loteadora.lot_field_id, text: String(lote) },
      { id: loteadora.expiry_field_id, text: String(fechaCaducidad) },
    ]);
    return NextResponse.json({ ok: true, warning });
  } catch (err: any) {
    console.error('Envío a loteadora error:', err);
    // Detalle adicional (bytes de estado en crudo) para el "ver más" del front —
    // no se traduce a texto porque la tabla de significado por bit no se puede
    // reconstruir de forma fiable desde el manual (ver lib/loteadora-printer.ts).
    const detail = await getPrinterStatusDetail(config).catch(() => null);
    return NextResponse.json({ error: err.message, detail: detail?.rawBytes ?? null }, { status: 502 });
  }
}
