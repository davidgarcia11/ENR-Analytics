// API de integración con GoLive (sistemas externos que avisan al dashboard). Por
// ahora es solo una "bandeja de entrada": cada mensaje se comprueba y se guarda en
// integracion_mensajes, y el panel NO hace nada con él. Qué hace el panel con cada
// tipo se programará más adelante, con los mensajes reales ya guardados a la vista.
// Ver docs/integracion-golive.md.
//
// Dos claves (cabecera x-api-key), como las de prueba y las reales de una pasarela
// de pago: INTEGRACION_API_KEY_PRUEBAS e INTEGRACION_API_KEY en .env.local. Lo que
// llega con la de pruebas se guarda marcado como prueba y nunca se procesará.
//
// Sin dependencias de servidor a propósito: las funciones reciben la conexión.
import { timingSafeEqual } from 'crypto';
import type Database from 'better-sqlite3';

export type TipoMensaje = 'escaneo';
/** Con qué clave llegó: la real o la de pruebas */
export type Origen = 'real' | 'prueba';

/** Tamaño máximo del cuerpo (un escaneo ocupa unos 200 bytes) */
export const MAX_CUERPO = 10_000;

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Qué clave es la recibida. `null` si no coincide con ninguna; 'sin-configurar' si
 * el servidor no tiene ninguna en .env.local (la API está apagada).
 */
export function origenDeClave(
  clave: string | null,
  env: { real?: string; prueba?: string } = { real: process.env.INTEGRACION_API_KEY, prueba: process.env.INTEGRACION_API_KEY_PRUEBAS },
): Origen | null | 'sin-configurar' {
  if (!env.real && !env.prueba) return 'sin-configurar';
  if (!clave) return null;
  if (env.real && igual(clave, env.real)) return 'real';
  if (env.prueba && igual(clave, env.prueba)) return 'prueba';
  return null;
}

export interface Escaneo {
  articulo: string;
  resultado: 'OK' | 'NO_OK';
  linea: string;
  lote: string;
  sscc: string;
  orden?: string;
  motivo?: string;
  /** Identificador único del mensaje, de GoLive: si se repite, no se guarda dos veces */
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
}

export function guardarMensaje(db: Database.Database, m: MensajeRecibido): number {
  return Number(db.prepare(
    `INSERT INTO integracion_mensajes (tipo, origen, cuerpo, valido, errores, id_externo, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(m.tipo, m.origen, m.cuerpo, m.valido ? 1 : 0, m.errores ? JSON.stringify(m.errores) : null, m.idExterno, m.ip).lastInsertRowid);
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
    `SELECT id, created_at AS fecha, tipo, origen, cuerpo, valido, errores, estado, ip
     FROM integracion_mensajes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA) as (Omit<FilaMensaje, 'valido' | 'errores'> & { valido: number; errores: string | null })[];
  return {
    filas: filas.map((r) => ({ ...r, valido: r.valido === 1, errores: r.errores ? JSON.parse(r.errores) : null })),
    total,
  };
}
