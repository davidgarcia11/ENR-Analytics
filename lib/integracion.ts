// API de integración (sistemas externos que avisan al dashboard). Por
// ahora es solo una "bandeja de entrada": cada mensaje se comprueba y se guarda en
// integracion_mensajes, y el panel NO hace nada con él. Qué hace el panel con cada
// tipo se programará más adelante, con los mensajes reales ya guardados a la vista.
// Ver docs/api-integracion.md.
//
// Se autentica con la cabecera x-api-key: claves creadas en /admin → Integración ›
// Claves de API (lib/api-claves.ts). Cada clave es real o de prueba: lo que llega con
// una de prueba se guarda marcado y nunca se procesará.
//
// Sin dependencias de servidor a propósito: las funciones reciben la conexión.
import type Database from 'better-sqlite3';

export type TipoMensaje = 'escaneo';
/** Con qué clave llegó: real o de prueba (su entorno) */
export type Origen = 'real' | 'prueba';

/** Tamaño máximo del cuerpo (un escaneo ocupa unos 200 bytes) */
export const MAX_CUERPO = 10_000;

export interface Escaneo {
  articulo: string;
  resultado: 'OK' | 'NO_OK';
  linea: string;
  lote: string;
  sscc: string;
  orden?: string;
  motivo?: string;
  /** Identificador único del mensaje, de quien lo envía: si se repite, no se guarda dos veces */
  id?: string;
}

/**
 * Comprueba un escaneo. Solo los campos del contrato: los demás se aceptan y se
 * guardan tal cual (si mañana mandan uno nuevo, no se les rompe nada). Todos van
 * como texto: el SSCC tiene 18 cifras y como número perdería precisión.
 */
export function validarEscaneo(cuerpo: unknown): { valor: Escaneo } | { errores: string[] } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return { errores: ['El cuerpo debe ser un objeto JSON'] };
  const c = cuerpo as Record<string, unknown>;
  const errores: string[] = [];
  // 'si': obligatorio y con valor; 'vacio': tiene que venir, pero puede ser ""; 'no': opcional
  const texto = (k: string, obligatorio: 'si' | 'vacio' | 'no', max: number, patron?: RegExp, formato?: string): string | undefined => {
    const v = c[k];
    if (v === undefined || v === null) {
      if (obligatorio !== 'no') errores.push(`${k}: es obligatorio`);
      return undefined;
    }
    if (typeof v !== 'string') { errores.push(`${k}: debe ir como texto, entre comillas`); return undefined; }
    const t = v.trim();
    if (!t && obligatorio === 'si') { errores.push(`${k}: no puede ir vacío`); return undefined; }
    if (t.length > max) { errores.push(`${k}: como mucho ${max} caracteres`); return undefined; }
    if (t && patron && !patron.test(t)) { errores.push(`${k}: ${formato}`); return undefined; }
    return t;
  };

  const articulo = texto('articulo', 'si', 10, /^\d{10}$/, 'deben ser 10 cifras');
  const resultado = texto('resultado', 'si', 5, /^(OK|NO_OK)$/, 'debe ser "OK" o "NO_OK"');
  const linea = texto('linea', 'si', 10);
  // Lote y SSCC pueden ir vacíos ("") si en ese momento no los tienen (p. ej. NO_OK)
  const lote = texto('lote', 'vacio', 30);
  const sscc = texto('sscc', 'vacio', 18, /^\d{18}$/, 'deben ser 18 cifras, sin el (00)');
  const orden = texto('orden', 'no', 20);
  const motivo = texto('motivo', 'no', 200);
  const id = texto('id', 'no', 64);

  if (errores.length) return { errores };
  return {
    valor: {
      articulo: articulo!, resultado: resultado as Escaneo['resultado'], linea: linea!, lote: lote!, sscc: sscc!,
      ...(orden ? { orden } : {}), ...(motivo ? { motivo } : {}), ...(id ? { id } : {}),
    },
  };
}

export interface MensajeRecibido {
  tipo: TipoMensaje;
  origen: Origen;
  /** El cuerpo tal cual llegó (texto), aunque no sea JSON válido */
  cuerpo: string;
  valido: boolean;
  errores: string[] | null;
  idExterno: string | null;
  ip: string | null;
  /** La clave con la que llegó (su nombre se copia: sigue valiendo si se elimina) */
  clave: { id: number; nombre: string };
}

export function guardarMensaje(db: Database.Database, m: MensajeRecibido): number {
  return Number(db.prepare(
    `INSERT INTO integracion_mensajes (tipo, origen, cuerpo, valido, errores, id_externo, ip, clave_id, clave_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.tipo, m.origen, m.cuerpo, m.valido ? 1 : 0, m.errores ? JSON.stringify(m.errores) : null, m.idExterno, m.ip,
    m.clave.id, m.clave.nombre).lastInsertRowid);
}

/** ¿Ya se recibió (y era válido) un mensaje con este id? Para no duplicar reintentos. */
export function yaRecibido(db: Database.Database, tipo: TipoMensaje, origen: Origen, idExterno: string): boolean {
  return !!db.prepare(
    'SELECT 1 FROM integracion_mensajes WHERE tipo = ? AND origen = ? AND id_externo = ? AND valido = 1 LIMIT 1'
  ).get(tipo, origen, idExterno);
}

export interface FiltrosMensajes {
  origen?: Origen;
  /** true: solo válidos; false: solo con errores */
  valido?: boolean;
  /** AAAA-MM-DD, en hora local */
  desde?: string;
  hasta?: string;
  /** Busca en el cuerpo (artículo, lote, SSCC, línea...) */
  q?: string;
  /** Desde 1 */
  pagina?: number;
}

export interface FilaMensaje {
  id: number;
  /** UTC, "AAAA-MM-DD HH:MM:SS" */
  fecha: string;
  tipo: TipoMensaje;
  origen: Origen;
  cuerpo: string;
  valido: boolean;
  errores: string[] | null;
  estado: string;
  ip: string | null;
  /** Nombre de la clave con la que llegó (null en los de antes de las claves del panel) */
  claveNombre: string | null;
}

export const POR_PAGINA = 50;

/** Mensajes recibidos, del más reciente al más antiguo, por páginas. */
export function buscarMensajes(db: Database.Database, f: FiltrosMensajes): { filas: FilaMensaje[]; total: number } {
  const donde: string[] = [];
  const args: (string | number)[] = [];
  if (f.origen) { donde.push('origen = ?'); args.push(f.origen); }
  if (f.valido !== undefined) { donde.push('valido = ?'); args.push(f.valido ? 1 : 0); }
  if (f.desde) { donde.push("date(created_at, 'localtime') >= ?"); args.push(f.desde); }
  if (f.hasta) { donde.push("date(created_at, 'localtime') <= ?"); args.push(f.hasta); }
  if (f.q) { donde.push('cuerpo LIKE ?'); args.push(`%${f.q}%`); }
  const where = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM integracion_mensajes ${where}`).get(...args) as { n: number }).n;
  const pagina = Math.max(1, f.pagina ?? 1);
  const filas = db.prepare(
    `SELECT id, created_at AS fecha, tipo, origen, cuerpo, valido, errores, estado, ip, clave_nombre AS claveNombre
     FROM integracion_mensajes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA) as (Omit<FilaMensaje, 'valido' | 'errores'> & { valido: number; errores: string | null })[];
  return {
    filas: filas.map((r) => ({ ...r, valido: r.valido === 1, errores: r.errores ? JSON.parse(r.errores) : null })),
    total,
  };
}

/**
 * Lee el cuerpo de una petición sin pasar de `max` bytes: si los supera, deja de leer y
 * devuelve null. Así un cuerpo enorme no se carga entero en memoria antes de rechazarlo
 * (ni siquiera con Content-Length falso o sin él).
 */
export async function leerCuerpo(req: Request, max = MAX_CUERPO): Promise<string | null> {
  if (Number(req.headers.get('content-length')) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    trozos.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(trozos));
}

/** Días que se guardan los mensajes de prueba; los reales, siempre (trazabilidad) */
export const DIAS_MENSAJES_PRUEBA = 90;

/** Borra los mensajes de prueba con más de DIAS_MENSAJES_PRUEBA días. Devuelve cuántos. */
export function limpiarPruebasAntiguas(db: Database.Database, dias = DIAS_MENSAJES_PRUEBA): number {
  return db.prepare(
    `DELETE FROM integracion_mensajes WHERE origen = 'prueba' AND created_at < datetime('now', ?)`
  ).run(`-${dias} days`).changes;
}

/**
 * Limpieza de mensajes de prueba al arrancar el servidor y luego una vez al día (lo
 * arranca instrumentation.ts, una sola vez por proceso).
 */
export function arrancarLimpieza(getDb: () => Database.Database): void {
  const g = globalThis as { __limpiezaIntegracion?: boolean };
  if (g.__limpiezaIntegracion) return;
  g.__limpiezaIntegracion = true;
  const limpiar = () => {
    try {
      const n = limpiarPruebasAntiguas(getDb());
      if (n) console.log(`[integración] ${n} mensaje(s) de prueba de más de ${DIAS_MENSAJES_PRUEBA} días borrados`);
    } catch (e) { console.error('[integración] error al limpiar mensajes de prueba:', e); }
  };
  limpiar();
  setInterval(limpiar, 24 * 60 * 60_000);
}
