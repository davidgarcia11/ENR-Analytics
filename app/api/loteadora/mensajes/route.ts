import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { listMessageNames } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
  zona_id: number | null;
}

// Lista las plantillas guardadas en una loteadora (comando 1F), para el
// desplegable de /loteadora. Requiere sesión, igual que /enviar.
export async function GET(req: NextRequest) {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;

  const loteadoraId = Number(req.nextUrl.searchParams.get('loteadoraId'));
  if (!loteadoraId) {
    return NextResponse.json({ error: 'Falta loteadoraId' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address, zona_id FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(loteadoraId) as LoteadoraRow | undefined;

  if (!loteadora || !puedeVerLoteadora(zonasVisibles(db, acceso.user), loteadora.zona_id)) {
    return NextResponse.json({ error: 'Loteadora no encontrada, deshabilitada o sin acceso (zona)' }, { status: 404 });
  }

  try {
    const messages = await listMessageNames({ ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address });
    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error('Listar plantillas de loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
