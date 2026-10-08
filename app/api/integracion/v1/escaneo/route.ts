import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { MAX_CUERPO, guardarMensaje, origenDeClave, validarEscaneo, yaRecibido } from '@/lib/integracion';

// POST /api/integracion/v1/escaneo — GoLive avisa de cada palet escaneado contra una
// orden de fabricación. Sin sesión de usuario: se autentica con la cabecera x-api-key
// (proxy.ts la deja pasar). Por ahora solo comprueba y guarda el mensaje
// (lib/integracion.ts): el panel no hace nada con él. Contrato y respuestas en
// docs/integracion-golive.md.
export async function POST(req: NextRequest) {
  const origen = origenDeClave(req.headers.get('x-api-key'));
  if (origen === 'sin-configurar') {
    return NextResponse.json({ ok: false, error: 'La integración no está configurada en el servidor' }, { status: 503 });
  }
  // Las llamadas sin clave válida no se guardan (no son de GoLive)
  if (!origen) return NextResponse.json({ ok: false, error: 'Clave no válida (cabecera x-api-key)' }, { status: 401 });

  const cuerpo = await req.text();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
  const db = getDb();
  const rechazar = (errores: string[]) => {
    guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo: cuerpo.slice(0, MAX_CUERPO), valido: false, errores, idExterno: null, ip });
    return NextResponse.json({ ok: false, errores }, { status: 400 });
  };

  if (cuerpo.length > MAX_CUERPO) return rechazar([`El cuerpo ocupa demasiado (máximo ${MAX_CUERPO} caracteres)`]);
  let json: unknown;
  try { json = JSON.parse(cuerpo); } catch { return rechazar(['El cuerpo no es un JSON válido']); }
  const v = validarEscaneo(json);
  if ('errores' in v) return rechazar(v.errores);

  // Un reintento con el mismo id no se guarda dos veces
  const idExterno = v.valor.id ?? null;
  if (idExterno && yaRecibido(db, 'escaneo', origen, idExterno)) {
    return NextResponse.json({ ok: true, id: idExterno, estado: 'duplicado', prueba: origen === 'prueba' });
  }
  const registro = guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo, valido: true, errores: null, idExterno, ip });
  return NextResponse.json(
    { ok: true, id: idExterno ?? String(registro), estado: 'recibido', prueba: origen === 'prueba' },
    { status: 202 },
  );
}
