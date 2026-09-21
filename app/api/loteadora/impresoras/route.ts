import { NextResponse } from 'next/server';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';

// Lista pública (sin admin) de loteadoras habilitadas, para el desplegable
// de selección de impresora en /loteadora. Expone id/name/linea (la línea de
// fabricación se muestra en la vista previa y decide si se puede enviar) —
// el resto de la config (IP, puerto, IDs de campo) vive en /api/loteadora/enviar.
export async function GET() {
  const denied = await requireScreenAccess('loteadora');
  if (denied) return denied;

  const db = getDb();
  const loteadoras = db.prepare('SELECT id, name, linea FROM loteadoras WHERE enabled = 1 ORDER BY name').all();
  return NextResponse.json(loteadoras);
}
