import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { loadPrintMessage, getPrinterStatus, listMessageNames } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
  zona_id: number | null;
}

// Carga una plantilla existente en la loteadora (comandos 1E + 01). Funciona
// con la impresión iniciada o parada: con la impresión parada devuelve un
// `warning` en vez de fallar (ver loadPrintMessage y docs/loteadora.md §11).
// Imprimiendo (estado 'activa') se rechaza: cambiar de mensaje a mitad de
// tirada mezclaría etiquetas de dos artículos (docs/loteadora.md §11).
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;

  const { loteadoraId, messageName } = await req.json();
  if (!loteadoraId || !messageName) {
    return NextResponse.json({ error: 'Faltan datos: loteadoraId y messageName son obligatorios' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address, zona_id FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as LoteadoraRow | undefined;

  if (!loteadora || !puedeVerLoteadora(zonasVisibles(db, acceso.user), loteadora.zona_id)) {
    return NextResponse.json({ error: 'Loteadora no encontrada, deshabilitada o sin acceso (zona)' }, { status: 404 });
  }

  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  if (await getPrinterStatus(config) === 'activa') {
    return NextResponse.json({ error: 'La loteadora está imprimiendo. Para la impresión en la máquina antes de cambiar la plantilla.' }, { status: 409 });
  }

  // Con la impresión parada la máquina responde OK aunque el nombre no exista
  // (y no carga nada), así que se comprueba contra su propia lista (1F). Si la
  // lista no se puede leer se intenta igual: el 1E dará el error de conexión.
  const nombres = await listMessageNames(config).catch(() => null);
  if (nombres && !nombres.includes(String(messageName))) {
    return NextResponse.json(
      { error: `La plantilla "${messageName}" no existe en esta loteadora. El nombre en /admin → Plantillas debe ser exactamente el del mensaje de la máquina (sin ".msg").` },
      { status: 404 }
    );
  }

  try {
    const { warning } = await loadPrintMessage(config, String(messageName));
    return NextResponse.json({ ok: true, warning });
  } catch (err: any) {
    console.error('Cargar plantilla en loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
