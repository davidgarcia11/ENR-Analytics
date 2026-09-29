import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { clearRemoteFieldBuffer } from '@/lib/loteadora-printer';

interface LoteadoraRow {
  ip: string;
  port: number;
  slave_address: number;
  zona_id: number | null;
}

// Vacía la cola de campos remotos pendientes de una loteadora (comando 21).
// No imprime nada — solo descarta envíos en cola que no se hayan consumido.
// Además de la pantalla, exige el permiso 'loteadora.limpiar-buffer' (admin siempre).
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;
  const permiso = await requireAccess({ permiso: 'loteadora.limpiar-buffer' });
  if (!permiso.ok) return permiso.denied;

  const { loteadoraId } = await req.json();
  if (!loteadoraId) {
    return NextResponse.json({ error: 'Falta loteadoraId' }, { status: 400 });
  }

  const db = getDb();
  const loteadora = db.prepare(
    'SELECT ip, port, slave_address, zona_id FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as LoteadoraRow | undefined;

  if (!loteadora || !puedeVerLoteadora(zonasVisibles(db, acceso.user), loteadora.zona_id)) {
    return NextResponse.json({ error: 'Loteadora no encontrada, deshabilitada o sin acceso (zona)' }, { status: 404 });
  }

  try {
    await clearRemoteFieldBuffer({ ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Limpiar buffer de loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
