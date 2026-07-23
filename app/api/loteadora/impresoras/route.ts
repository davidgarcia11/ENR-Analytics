import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';

// Lista pública (sin admin) de loteadoras habilitadas, para el desplegable
// de selección de impresora en /loteadora. Solo expone id/name — el resto
// de la config (IP, puerto, IDs de campo) vive en /api/loteadora/enviar.
export async function GET() {
  const db = getDb();
  const loteadoras = db.prepare('SELECT id, name FROM loteadoras WHERE enabled = 1 ORDER BY name').all();
  return NextResponse.json(loteadoras);
}
