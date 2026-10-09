import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { LIMITE_POR_MINUTO, dentroDelLimite, verificarClave } from '@/lib/api-claves';
import {
  MAX_CUERPO, escaneoRecibido, guardarMensaje, leerCuerpo, mismoEscaneo, validarEscaneo, type CodigoError,
} from '@/lib/integracion';

// POST /api/integracion/v1/escaneo — un sistema externo avisa de cada palet escaneado contra una
// orden de fabricación. Sin sesión de usuario: se autentica con la cabecera x-api-key,
// con una clave de /admin → Integración › Claves de API que dé acceso a 'escaneo'
// (proxy.ts deja pasar la ruta). Por ahora solo comprueba y guarda el mensaje
// (lib/integracion.ts): el panel no hace nada con él. Contrato y respuestas en
// docs/api-integracion.openapi.yaml (y docs/api-integracion.md).
//
// Orden de las comprobaciones: clave (401) → límite (429) → tipo de contenido (415) →
// tamaño (413) → JSON y campos (400) → id repetido (200 duplicado / 409 conflicto) → 202.
// Todas las respuestas llevan Cache-Control: no-store; los errores, siempre
// { ok: false, codigo, errores: [...] } (CODIGOS_ERROR).

const SIN_CACHE = { 'Cache-Control': 'no-store' };

function error(status: number, codigo: CodigoError, errores: string[], cabeceras: Record<string, string> = {}) {
  return NextResponse.json({ ok: false, codigo, errores }, { status, headers: { ...SIN_CACHE, ...cabeceras } });
}

export async function POST(req: NextRequest) {
  try {
    // Orientativa: Next solo rellena x-forwarded-for si no viene, así que quien llama
    // puede poner la que quiera. No sirve para restringir por IP (ver docs §3).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null;
    const db = getDb();
    // Las llamadas sin clave válida no se guardan (no son de ningún sistema autorizado) ni se dice por qué
    const clave = verificarClave(db, req.headers.get('x-api-key'), 'escaneo', ip);
    if (!clave) {
      return error(401, 'CLAVE_NO_VALIDA', ['Clave no válida (cabecera x-api-key)'], {
        'WWW-Authenticate': 'ApiKey realm="integracion", header="x-api-key"',
      });
    }

    // Antes de leer el cuerpo: una clave filtrada o un bucle no llena la BD
    const limite = dentroDelLimite(clave.id);
    if (!limite.ok) {
      return error(429, 'DEMASIADAS_PETICIONES', [`Demasiadas peticiones: como mucho ${LIMITE_POR_MINUTO} por minuto con cada clave`], {
        'Retry-After': String(limite.reintentarEn),
      });
    }

    const origen = clave.entorno;
    const deClave = { id: clave.id, nombre: clave.nombre };
    // Los rechazos con clave válida se guardan (con lo leído), para revisarlos con quien envía
    const rechazar = (status: number, codigo: CodigoError, cuerpo: string, errores: string[]) => {
      guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo, valido: false, errores, idExterno: null, ip, clave: deClave });
      return error(status, codigo, errores);
    };

    // Solo JSON (admite "; charset=utf-8" detrás)
    const tipo = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') {
      return rechazar(415, 'TIPO_NO_ADMITIDO', '', [`El cuerpo tiene que enviarse como JSON (cabecera Content-Type: application/json${tipo ? `, no ${tipo.slice(0, 60)}` : ''})`]);
    }

    // Se deja de leer al pasar del máximo: no se carga entero en memoria
    const cuerpo = await leerCuerpo(req, MAX_CUERPO);
    if (cuerpo === null) return rechazar(413, 'DEMASIADO_GRANDE', '', [`El cuerpo ocupa demasiado (máximo ${MAX_CUERPO} bytes)`]);
    let json: unknown;
    try { json = JSON.parse(cuerpo); } catch { return rechazar(400, 'DATOS_INCORRECTOS', cuerpo, ['El cuerpo no es un JSON válido']); }
    const v = validarEscaneo(json);
    if ('errores' in v) return rechazar(400, 'DATOS_INCORRECTOS', cuerpo, v.errores);

    // Mismo id: con los mismos datos es un reintento (no se guarda otra vez); con otros
    // datos es un id reutilizado por error, y se rechaza para que no se pierda en silencio
    const idExterno = v.valor.id ?? null;
    if (idExterno) {
      const anterior = escaneoRecibido(db, origen, idExterno);
      if (anterior && mismoEscaneo(anterior, v.valor)) {
        return NextResponse.json({ ok: true, id: idExterno, estado: 'duplicado', prueba: origen === 'prueba' }, { headers: SIN_CACHE });
      }
      if (anterior) {
        return rechazar(409, 'ID_EN_CONFLICTO', cuerpo, [`id: «${idExterno}» ya se recibió con otros datos; cada mensaje necesita un id distinto`]);
      }
    }
    const registro = guardarMensaje(db, { tipo: 'escaneo', origen, cuerpo, valido: true, errores: null, idExterno, ip, clave: deClave });
    return NextResponse.json(
      { ok: true, id: idExterno ?? String(registro), estado: 'recibido', prueba: origen === 'prueba' },
      { status: 202, headers: SIN_CACHE },
    );
  } catch (err) {
    // Cualquier fallo interno (p. ej. la BD ocupada): JSON y al log; quien llama reintenta con el mismo id
    console.error('[integración] error en /api/integracion/v1/escaneo:', err);
    return error(500, 'ERROR_INTERNO', ['Error interno del servidor; reintentad con el mismo id']);
  }
}
