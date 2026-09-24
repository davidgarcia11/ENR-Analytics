import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { disponerCampos, leerCampos } from '@/lib/loteadora-plantilla';
import { downloadMessage, getPrinterStatus, listMessageNames } from '@/lib/loteadora-printer';

// Crea (o sustituye) en una loteadora el mensaje de una plantilla, con sus campos
// colocados por disponerCampos() (comando 1C). Solo admin. El reloj no existe en
// el 1C: se inserta a mano en la máquina, y si el mensaje ya existía se pierde el
// que tuviera (el panel lo avisa antes). Ver docs/loteadora.md §9 y §13.
//
// Body: { loteadoraId }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const mensajeId = Number(id);
  const { loteadoraId } = await req.json().catch(() => ({}));

  const db = getDb();
  const mensaje = db.prepare('SELECT name FROM loteadora_mensajes WHERE id = ?').get(mensajeId) as { name: string } | undefined;
  if (!mensaje) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  const campos = leerCampos(db, [mensajeId]).get(mensajeId) ?? [];
  if (campos.length === 0) return NextResponse.json({ error: 'La plantilla no tiene campos' }, { status: 400 });

  const loteadora = db.prepare('SELECT ip, port, slave_address FROM loteadoras WHERE id = ?').get(Number(loteadoraId)) as
    { ip: string; port: number; slave_address: number } | undefined;
  if (!loteadora) return NextResponse.json({ error: 'Loteadora no encontrada' }, { status: 404 });
  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  // Crear un mensaje lo deja en el área de edición: imprimiendo, no.
  if (await getPrinterStatus(config) === 'activa') {
    return NextResponse.json({ error: 'La loteadora está imprimiendo. Para la impresión en la máquina antes de crear el mensaje.' }, { status: 409 });
  }

  try {
    const antes = await listMessageNames(config).catch(() => null);
    await downloadMessage(config, mensaje.name, disponerCampos(campos));
    const despues = await listMessageNames(config).catch(() => null);
    if (despues && !despues.includes(mensaje.name)) {
      return NextResponse.json({ error: 'La loteadora aceptó el mensaje pero no aparece en su lista. Revísalo en la máquina.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, existia: antes?.includes(mensaje.name) ?? null });
  } catch (err: any) {
    console.error('Crear mensaje en loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
