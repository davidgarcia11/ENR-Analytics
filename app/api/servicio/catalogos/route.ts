// Opciones activas de los desplegables de /servicio (motivos, responsables, transportistas).
// Solo lee SQLite (la lista se edita en /admin → Listas de servicio). Ver docs/servicio.md.
import { NextResponse } from 'next/server';
import { requireScreenAccess } from '@/lib/permissions';
import { catalogoActivo } from '@/lib/servicio-catalogo';

export async function GET() {
  const denied = await requireScreenAccess('servicio');
  if (denied) return denied;
  const c = catalogoActivo();
  return NextResponse.json({ motivos: c.motivo, responsables: c.responsable, transportistas: c.transportista });
}
