import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';

// Datos fijos de todas las plantillas (piezas tipo 'fijo': precio, nº de
// certificado...). Los ve y cambia quien tenga el permiso
// los permisos de Datos fijos (lib/permisos.ts) sin poder tocar el resto de la
// plantilla, que sigue siendo solo de admin.
export async function GET() {
  const acceso = await requireAccess({ permiso: L('datos-fijos') });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const datos = db.prepare(`
    SELECT s.id, s.nombre, s.valor, s.field_id AS fieldId, m.id AS mensajeId, m.name AS plantilla
    FROM loteadora_mensaje_segmentos s
    JOIN loteadora_mensajes m ON m.id = s.mensaje_id
    WHERE s.tipo = 'fijo'
    ORDER BY m.name, s.orden
  `).all();
  return NextResponse.json(datos);
}
