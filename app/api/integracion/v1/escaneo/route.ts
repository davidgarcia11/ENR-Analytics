import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verificarClave } from '@/lib/api-claves';
import { MAX_CUERPO, guardarMensaje, validarEscaneo, yaRecibido } from '@/lib/integracion';

// POST /api/integracion/v1/escaneo — GoLive avisa de cada palet escaneado contra una
// orden de fabricación. Sin sesión de usuario: se autentica con la cabecera x-api-key,
// con una clave de /admin → Integración › Claves de API que dé acceso a 'escaneo'
// (proxy.ts deja pasar la ruta). Por ahora solo comprueba y guarda el mensaje
// (lib/integracion.ts): el panel no hace nada con él. Contrato y respuestas en
// docs/integracion-golive.md.
export async function POST(req: NextRequest) {
  // Orientativa: Next solo rellena x-forwarded-for si no viene, así que quien llama
  // puede poner la que quiera. No sirve para restringir por IP (ver docs §3).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
  const db = getDb();
  // Las llamadas sin clave válida no se guardan (no son de GoLive) ni se dice por qué
  const clave = verificarClave(db, req.headers.get('x-api-key'), 'escaneo', ip);
  if (!clave) return NextResponse.json({ ok: false, error: 'Clave no válida (cabecera x-api-key)' }, { status: 401 });

  const origen = clave.entorno;
  const deClave = { id: clave.id, nombre: clave.nombre };
  const cuerpo = await req.text();
  const rechazar = (errores: string[]) => {
    guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo: cuerpo.slice(0, MAX_CUERPO), valido: false, errores, idExterno: null, ip, clave: deClave });
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
  const registro = guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo, valido: true, errores: null, idExterno, ip, clave: deClave });
  return NextResponse.json(
    { ok: true, id: idExterno ?? String(registro), estado: 'recibido', prueba: origen === 'prueba' },
    { status: 202 },
  );
}
