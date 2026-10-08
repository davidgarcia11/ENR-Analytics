import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { POR_PAGINA, buscarMensajes } from '@/lib/integracion';

// Mensajes recibidos por la API de integración con GoLive (/admin → Integración).
// Solo lectura. GET ?origen=real|prueba&valido=1|0&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&q=&pagina=
// → { filas, total, porPagina }
export async function GET(req: NextRequest) {
  const acceso = await requireAccess({ permiso: 'admin.integracion.ver' });
  if (!acceso.ok) return acceso.denied;

  const sp = req.nextUrl.searchParams;
  const fecha = (k: string) => {
    const v = sp.get(k) ?? '';
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const origen = sp.get('origen');
  const valido = sp.get('valido');
  const pagina = Number(sp.get('pagina'));

  const { filas, total } = buscarMensajes(getDb(), {
    origen: origen === 'real' || origen === 'prueba' ? origen : undefined,
    valido: valido === '1' ? true : valido === '0' ? false : undefined,
    desde: fecha('desde'), hasta: fecha('hasta'),
    q: (sp.get('q') ?? '').trim().slice(0, 60) || undefined,
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : undefined,
  });
  return NextResponse.json({ filas, total, porPagina: POR_PAGINA });
}
