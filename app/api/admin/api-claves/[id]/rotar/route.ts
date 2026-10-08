import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { rotarClave, type FinVieja } from '@/lib/api-claves';

// POST /api/admin/api-claves/:id/rotar { fin: 'ahora' | '1' | '7' } → { clave, fila }
// Crea una clave nueva con la misma configuración y pone fin a la vieja (ya, o en 1
// o 7 días). Solo admin. La clave nueva completa solo viaja en esta respuesta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const body = await req.json().catch(() => null);
  const fin = body?.fin as FinVieja;
  if (!['ahora', '1', '7'].includes(fin)) return NextResponse.json({ error: 'Elige cuánto sigue valiendo la clave anterior' }, { status: 400 });
  const r = rotarClave(getDb(), Number((await params).id), fin, acceso.user?.username ?? null);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r, { status: 201 });
}
