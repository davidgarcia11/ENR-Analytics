import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { LIMITE_POR_MINUTO, dentroDelLimite, verificarClave } from '@/lib/api-claves';
import { MAX_CUERPO, guardarMensaje, leerCuerpo, validarEscaneo, yaRecibido } from '@/lib/integracion';

// POST /api/integracion/v1/escaneo — GoLive avisa de cada palet escaneado contra una
// orden de fabricación. Sin sesión de usuario: se autentica con la cabecera x-api-key,
// con una clave de /admin → Integración › Claves de API que dé acceso a 'escaneo'
// (proxy.ts deja pasar la ruta). Por ahora solo comprueba y guarda el mensaje
// (lib/integracion.ts): el panel no hace nada con él. Contrato y respuestas en
// docs/integracion-golive.openapi.yaml (y docs/integracion-golive.md).
export async function POST(req: NextRequest) {
  // Orientativa: Next solo rellena x-forwarded-for si no viene, así que quien llama
  // puede poner la que quiera. No sirve para restringir por IP (ver docs §3).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
  const db = getDb();
  // Las llamadas sin clave válida no se guardan (no son de GoLive) ni se dice por qué
  const clave = verificarClave(db, req.headers.get('x-api-key'), 'escaneo', ip);
  if (!clave) return NextResponse.json({ ok: false, error: 'Clave no válida (cabecera x-api-key)' }, { status: 401 });

  // Antes de leer el cuerpo: una clave filtrada o un bucle no llena la BD
  const limite = dentroDelLimite(clave.id);
  if (!limite.ok) {
    return NextResponse.json(
      { ok: false, error: `Demasiadas peticiones: como mucho ${LIMITE_POR_MINUTO} por minuto con cada clave` },
      { status: 429, headers: { 'Retry-After': String(limite.reintentarEn) } },
    );
  }

  const origen = clave.entorno;
  const deClave = { id: clave.id, nombre: clave.nombre };
  const rechazar = (cuerpo: string, errores: string[], status = 400) => {
    guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo, valido: false, errores, idExterno: null, ip, clave: deClave });
    return NextResponse.json({ ok: false, errores }, { status });
  };

  // Se deja de leer al pasar del máximo: no se carga entero en memoria
  const cuerpo = await leerCuerpo(req, MAX_CUERPO);
  if (cuerpo === null) return rechazar('', [`El cuerpo ocupa demasiado (máximo ${MAX_CUERPO} bytes)`], 413);
  let json: unknown;
  try { json = JSON.parse(cuerpo); } catch { return rechazar(cuerpo, ['El cuerpo no es un JSON válido']); }
  const v = validarEscaneo(json);
  if ('errores' in v) return rechazar(cuerpo, v.errores);

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
