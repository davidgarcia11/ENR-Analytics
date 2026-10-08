import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { editarClave, eliminarClave, estadoClave, leerClave, revocarClave, validarDatosClave } from '@/lib/api-claves';

// Una clave de API (/admin → Integración › Claves de API). Solo admin.
// PATCH { revocar: true } → la revoca   PATCH { nombre, ambitos, caducaEl, notas } → la edita
// DELETE → la elimina (solo si ya no vale: revocada o caducada)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const id = Number((await params).id);
  const db = getDb();
  const clave = leerClave(db, id);
  if (!clave) return NextResponse.json({ error: 'Clave no encontrada' }, { status: 404 });
  const body = await req.json().catch(() => null);

  if (body?.revocar === true) {
    revocarClave(db, id, acceso.user?.username ?? null);
    return NextResponse.json({ ok: true });
  }
  // Revocada ya no se toca (no se puede "desrevocar")
  if (estadoClave(clave) === 'revocada') return NextResponse.json({ error: 'La clave está revocada' }, { status: 409 });
  const v = validarDatosClave(body);
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 });
  editarClave(db, id, v.valor);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const r = eliminarClave(getDb(), Number((await params).id));
  if (r.error) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
