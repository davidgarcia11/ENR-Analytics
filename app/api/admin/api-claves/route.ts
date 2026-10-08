import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { AMBITOS, crearClave, estadoClave, listarClaves, validarDatosClave } from '@/lib/api-claves';

// Claves de API (/admin → Integración › Claves de API). Solo admin.
// GET → { claves (con su estado), ambitos }   POST { nombre, entorno, ambitos, caducaEl, notas } → { clave, fila }
// La clave completa solo viaja en la respuesta del POST: después ya no se puede ver.
export async function GET() {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const claves = listarClaves(getDb()).map((c) => ({ ...c, estado: estadoClave(c) }));
  return NextResponse.json({ claves, ambitos: AMBITOS });
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  const body = await req.json().catch(() => null);
  const entorno = body?.entorno;
  if (entorno !== 'real' && entorno !== 'prueba') return NextResponse.json({ error: 'Elige si es una clave real o de prueba' }, { status: 400 });
  const v = validarDatosClave(body);
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 });
  return NextResponse.json(crearClave(getDb(), entorno, v.valor, acceso.user?.username ?? null), { status: 201 });
}
