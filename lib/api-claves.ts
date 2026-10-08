// Claves de API para los sistemas externos que llaman al dashboard (hoy, GoLive).
// Se gestionan desde /admin → Integración › Claves de API (solo admin): crear,
// editar, rotar, revocar y eliminar, con caducidad opcional. Ver docs/integracion-golive.md.
//
// Como las contraseñas: la clave completa solo se enseña al crearla. En la BD queda
// su huella SHA-256 (si alguien copia la BD, no saca las claves) y un prefijo
// visible para reconocerla ("enr_test_3f9a…"). Cada clave es de un entorno (real o
// prueba, va en el prefijo) y solo vale para las APIs marcadas (`ambitos`).
//
// Sin dependencias de servidor a propósito: las funciones reciben la conexión.
import { createHash, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';

/** APIs a las que puede dar acceso una clave. Una API nueva con clave: una entrada aquí. */
export const AMBITOS = {
  escaneo: { label: 'GoLive — aviso de escaneo', ruta: 'POST /api/integracion/v1/escaneo' },
} as const;
export type Ambito = keyof typeof AMBITOS;
export const LISTA_AMBITOS = Object.keys(AMBITOS) as Ambito[];

export type Entorno = 'real' | 'prueba';
export type EstadoClave = 'activa' | 'caducada' | 'revocada';

export interface ClaveApi {
  id: number;
  nombre: string;
  /** Lo que se enseña de la clave: "enr_live_3f9a" */
  prefijo: string;
  entorno: Entorno;
  ambitos: Ambito[];
  notas: string | null;
  /** Último día en que vale (AAAA-MM-DD, hora local); null = sin caducidad */
  caducaEl: string | null;
  creadaPor: string | null;
  /** UTC, "AAAA-MM-DD HH:MM:SS" */
  creadaAt: string;
  revocadaPor: string | null;
  revocadaAt: string | null;
  ultimoUsoAt: string | null;
  ultimoUsoIp: string | null;
}

export const huella = (clave: string) => createHash('sha256').update(clave).digest('hex');

/** Hoy en hora local, AAAA-MM-DD */
export const hoyLocal = (ahora = new Date()) => ahora.toLocaleDateString('sv-SE');

/** Una clave nueva: 192 bits al azar tras el prefijo de su entorno. */
export function generarClave(entorno: Entorno): { clave: string; prefijo: string; hash: string } {
  const clave = `enr_${entorno === 'real' ? 'live' : 'test'}_${randomBytes(24).toString('base64url')}`;
  return { clave, prefijo: clave.slice(0, 13), hash: huella(clave) };
}

export function estadoClave(c: Pick<ClaveApi, 'revocadaAt' | 'caducaEl'>, hoy = hoyLocal()): EstadoClave {
  if (c.revocadaAt) return 'revocada';
  if (c.caducaEl && hoy > c.caducaEl) return 'caducada';
  return 'activa';
}

export interface DatosClave {
  nombre: string;
  ambitos: Ambito[];
  caducaEl: string | null;
  notas: string | null;
}

/** Comprueba lo que llega del formulario. El entorno solo al crear (va en la clave). */
export function validarDatosClave(body: any, hoy = hoyLocal()): { valor: DatosClave } | { error: string } {
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre || nombre.length > 60) return { error: 'El nombre es obligatorio (hasta 60 caracteres)' };
  const ambitos = Array.isArray(body?.ambitos) ? [...new Set(body.ambitos)] : [];
  if (ambitos.length === 0 || !ambitos.every((a) => LISTA_AMBITOS.includes(a as Ambito))) {
    return { error: 'Marca al menos una API a la que da acceso' };
  }
  let caducaEl: string | null = null;
  if (body?.caducaEl) {
    if (typeof body.caducaEl !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.caducaEl)) return { error: 'Fecha de caducidad no válida' };
    if (body.caducaEl < hoy) return { error: 'La caducidad no puede ser anterior a hoy' };
    caducaEl = body.caducaEl;
  }
  const notas = typeof body?.notas === 'string' && body.notas.trim() ? body.notas.trim() : null;
  if (notas && notas.length > 300) return { error: 'Las notas, como mucho 300 caracteres' };
  return { valor: { nombre, ambitos: ambitos as Ambito[], caducaEl, notas } };
}

const COLUMNAS = `id, nombre, prefijo, entorno, ambitos, notas, caduca_el AS caducaEl, creada_por AS creadaPor,
  created_at AS creadaAt, revocada_por AS revocadaPor, revocada_at AS revocadaAt, ultimo_uso_at AS ultimoUsoAt,
  ultimo_uso_ip AS ultimoUsoIp`;
type FilaBd = Omit<ClaveApi, 'ambitos'> & { ambitos: string };
const deFila = (f: FilaBd): ClaveApi => ({ ...f, ambitos: JSON.parse(f.ambitos) });

export function listarClaves(db: Database.Database): ClaveApi[] {
  return (db.prepare(`SELECT ${COLUMNAS} FROM api_claves ORDER BY id DESC`).all() as FilaBd[]).map(deFila);
}

export function leerClave(db: Database.Database, id: number): ClaveApi | null {
  const f = db.prepare(`SELECT ${COLUMNAS} FROM api_claves WHERE id = ?`).get(id) as FilaBd | undefined;
  return f ? deFila(f) : null;
}

/** Crea una clave y devuelve la clave completa: es la única vez que se puede ver. */
export function crearClave(db: Database.Database, entorno: Entorno, d: DatosClave, usuario: string | null): { clave: string; fila: ClaveApi } {
  const { clave, prefijo, hash } = generarClave(entorno);
  const id = Number(db.prepare(
    `INSERT INTO api_claves (nombre, prefijo, hash, entorno, ambitos, notas, caduca_el, creada_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(d.nombre, prefijo, hash, entorno, JSON.stringify(d.ambitos), d.notas, d.caducaEl, usuario).lastInsertRowid);
  return { clave, fila: leerClave(db, id)! };
}

export function editarClave(db: Database.Database, id: number, d: DatosClave): void {
  db.prepare('UPDATE api_claves SET nombre = ?, ambitos = ?, caduca_el = ?, notas = ? WHERE id = ?')
    .run(d.nombre, JSON.stringify(d.ambitos), d.caducaEl, d.notas, id);
}

export function revocarClave(db: Database.Database, id: number, usuario: string | null): void {
  db.prepare('UPDATE api_claves SET revocada_at = CURRENT_TIMESTAMP, revocada_por = ? WHERE id = ? AND revocada_at IS NULL').run(usuario, id);
}

/** Solo las que ya no valen (revocadas o caducadas): una activa se revoca antes. */
export function eliminarClave(db: Database.Database, id: number): { error?: string } {
  const c = leerClave(db, id);
  if (!c) return { error: 'Clave no encontrada' };
  if (estadoClave(c) === 'activa') return { error: 'Revoca la clave antes de eliminarla' };
  db.prepare('DELETE FROM api_claves WHERE id = ?').run(id);
  return {};
}

/** Cuánto sigue valiendo la clave vieja al rotar: nada, 1 día o 7 días más */
export type FinVieja = 'ahora' | '1' | '7';

/**
 * Rota una clave: crea otra con la misma configuración y le pone fin a la vieja,
 * ya (revocada) o dentro de 1 o 7 días (caducidad), para que el otro lado la cambie
 * sin cortes. Si la vieja ya caducaba antes, se respeta su fecha.
 */
export function rotarClave(db: Database.Database, id: number, fin: FinVieja, usuario: string | null, ahora = new Date()): { clave: string; fila: ClaveApi } | { error: string } {
  const vieja = leerClave(db, id);
  if (!vieja) return { error: 'Clave no encontrada' };
  if (estadoClave(vieja, hoyLocal(ahora)) !== 'activa') return { error: 'Solo se puede rotar una clave activa' };
  return db.transaction(() => {
    const nueva = crearClave(db, vieja.entorno, {
      nombre: vieja.nombre, ambitos: vieja.ambitos, notas: vieja.notas, caducaEl: vieja.caducaEl,
    }, usuario);
    if (fin === 'ahora') revocarClave(db, id, usuario);
    else {
      const finEl = hoyLocal(new Date(ahora.getTime() + Number(fin) * 86_400_000));
      if (!vieja.caducaEl || finEl < vieja.caducaEl) db.prepare('UPDATE api_claves SET caduca_el = ? WHERE id = ?').run(finEl, id);
    }
    return nueva;
  })();
}

/**
 * La clave de una petición, si vale para esa API: existe, no está revocada ni
 * caducada y tiene ese ámbito. Si vale, apunta su último uso. Si no, null (la
 * respuesta no dice por qué, para no dar pistas).
 */
export function verificarClave(db: Database.Database, clave: string | null, ambito: Ambito, ip: string | null): ClaveApi | null {
  if (!clave || clave.length > 200) return null;
  const f = db.prepare(`SELECT ${COLUMNAS} FROM api_claves WHERE hash = ?`).get(huella(clave)) as FilaBd | undefined;
  if (!f) return null;
  const c = deFila(f);
  if (estadoClave(c) !== 'activa' || !c.ambitos.includes(ambito)) return null;
  db.prepare('UPDATE api_claves SET ultimo_uso_at = CURRENT_TIMESTAMP, ultimo_uso_ip = ? WHERE id = ?').run(ip, c.id);
  return c;
}

/** Peticiones por minuto que admite cada clave; por encima, 429 */
export const LIMITE_POR_MINUTO = 120;

// Ventana de un minuto por clave, en memoria del proceso.
// ponytail: en memoria, basta con un único servidor; con varios, a la BD o a un Redis
const ventanas = new Map<number, { inicio: number; n: number }>();

/**
 * ¿Puede esta clave hacer otra petición? Ventana fija de un minuto. Si no, los
 * segundos que faltan para la siguiente ventana (para la cabecera Retry-After).
 */
export function dentroDelLimite(claveId: number, ahora = Date.now(), limite = LIMITE_POR_MINUTO): { ok: true } | { ok: false; reintentarEn: number } {
  const v = ventanas.get(claveId);
  if (!v || ahora - v.inicio >= 60_000) {
    ventanas.set(claveId, { inicio: ahora, n: 1 });
    return { ok: true };
  }
  if (v.n >= limite) return { ok: false, reintentarEn: Math.ceil((v.inicio + 60_000 - ahora) / 1000) };
  v.n++;
  return { ok: true };
}
