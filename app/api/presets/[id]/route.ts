import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  // Solo puede borrar sus propios presets
  db.prepare('DELETE FROM presets WHERE id = ? AND user_id = ?').run(Number(id), user.id);

  return NextResponse.json({ ok: true });
}
