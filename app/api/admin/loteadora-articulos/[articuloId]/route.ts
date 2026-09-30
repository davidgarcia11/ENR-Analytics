import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ articuloId: string }> }) {
  const acceso = await requireAccess({ permiso: L('articulos', 'eliminar') });
  if (!acceso.ok) return acceso.denied;

  const { articuloId } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadora_articulo_mensajes WHERE articulo_id = ?').run(articuloId);

  return NextResponse.json({ ok: true });
}
