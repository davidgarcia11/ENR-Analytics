import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { getDb } from '@/lib/sqlite';

// Lista pública (sin admin) de loteadoras habilitadas, para el desplegable
// de selección de impresora en /loteadora. Expone id/name/linea (la línea de
// fabricación se muestra en la vista previa y decide si se puede enviar) —
// el resto de la config (IP, puerto, IDs de campo) vive en /api/loteadora/enviar.
export async function GET() {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  // Solo las de las zonas que puede ver el usuario (lib/loteadora-zonas.ts)
  const zonas = zonasVisibles(db, acceso.user);
  const loteadoras = (db.prepare(
    `SELECT l.id, l.name, l.linea, l.familias, l.zona_id, z.nombre AS zona
     FROM loteadoras l LEFT JOIN zonas z ON z.id = l.zona_id
     WHERE l.enabled = 1 ORDER BY l.name`
  ).all() as { zona_id: number | null }[]).filter((l) => puedeVerLoteadora(zonas, l.zona_id));
  return NextResponse.json(loteadoras);
}
