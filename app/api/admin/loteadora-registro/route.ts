import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';
import { POR_PAGINA, buscarEnvios, maquinasDelRegistro } from '@/lib/loteadora-registro';

// Registro de envíos a las loteadoras (/admin → Loteadora › Registro). Solo lectura.
// GET ?loteadoraId=&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&usuario=&q=&pagina=
// → { filas, total, porPagina, maquinas }
export async function GET(req: NextRequest) {
  const acceso = await requireAccess({ permiso: L('registro') });
  if (!acceso.ok) return acceso.denied;

  const sp = req.nextUrl.searchParams;
  const fecha = (k: string) => {
    const v = sp.get(k) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const texto = (k: string) => (sp.get(k) ?? '').trim().slice(0, 60) || undefined;
  const entero = (k: string) => {
    const n = Number(sp.get(k));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const db = getDb();
  const { filas, total } = buscarEnvios(db, {
    loteadoraId: entero('loteadoraId'), desde: fecha('desde'), hasta: fecha('hasta'),
    usuario: texto('usuario'), q: texto('q'), pagina: entero('pagina'),
  });
  return NextResponse.json({ filas, total, porPagina: POR_PAGINA, maquinas: maquinasDelRegistro(db) });
}
