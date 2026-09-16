import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ articuloId: string }> }) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { articuloId } = await params;
  const db = getDb();
  db.prepare('DELETE FROM loteadora_articulo_mensajes WHERE articulo_id = ?').run(articuloId);

  return NextResponse.json({ ok: true });
}
