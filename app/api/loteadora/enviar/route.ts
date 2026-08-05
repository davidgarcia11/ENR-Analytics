import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { sendRemoteFields, getPrinterStatusDetail } from '@/lib/loteadora-printer';

// Envía lote, fecha de cocida y fecha de caducidad a una loteadora física por
// TCP (comando 1D del protocolo TIJ). A diferencia de marcas/articulos, este
// endpoint sí exige sesión: dispara una acción física real (imprime una etiqueta).
//
// Los IDs de campo (lote/cocida/caducidad) NO los manda el cliente: se
// resuelven aquí a partir de la plantilla asociada al artículo
// (loteadora_articulo_mensajes), igual que el resto de valores que llegan del
// cliente a una API route (ver CLAUDE.md, sección Seguridad).
export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { loteadoraId, articuloId, lote, fechaCocida, fechaCaducidad } = await req.json();

  if (!loteadoraId || !articuloId || !lote || !fechaCocida || !fechaCaducidad) {
    return NextResponse.json(
      { error: 'Faltan datos: loteadoraId, articuloId, lote, fechaCocida y fechaCaducidad son obligatorios' },
      { status: 400 }
    );
  }

  const db = getDb();

  const loteadora = db.prepare(
    'SELECT ip, port, slave_address FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as { ip: string; port: number; slave_address: number } | undefined;

  if (!loteadora) {
    return NextResponse.json({ error: 'Loteadora no encontrada o deshabilitada' }, { status: 404 });
  }

  const mensaje = db.prepare(
    `SELECT m.lot_field_id AS lotFieldId, m.cocida_field_id AS cocidaFieldId, m.expiry_field_id AS expiryFieldId
     FROM loteadora_articulo_mensajes am
     JOIN loteadora_mensajes m ON m.id = am.mensaje_id
     WHERE am.articulo_id = ?`
  ).get(String(articuloId)) as { lotFieldId: number; cocidaFieldId: number; expiryFieldId: number } | undefined;

  if (!mensaje) {
    return NextResponse.json(
      { error: 'Este artículo no tiene una plantilla asociada. Configúrala en /admin antes de enviar.' },
      { status: 404 }
    );
  }

  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  try {
    const { warning } = await sendRemoteFields(config, [
      { id: mensaje.lotFieldId, text: String(lote) },
      { id: mensaje.cocidaFieldId, text: String(fechaCocida) },
      { id: mensaje.expiryFieldId, text: String(fechaCaducidad) },
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
