// Registro de todo lo enviado a las loteadoras desde /loteadora (tabla
// loteadora_envios): qué se mandó, a qué máquina, cuándo, quién y cómo fue. Es para
// trazabilidad, así que se guarda siempre y no depende de que la máquina o la
// plantilla sigan existiendo (se copian sus nombres). Solo los envíos que llegaron
// a la máquina: los que el panel rechaza antes (imprimiendo, datos que faltan) no.
// Ver docs/loteadora.md §19.
//
// Sin dependencias de servidor a propósito: las funciones reciben la conexión.
import type Database from 'better-sqlite3';
import type { TrozoEtiqueta } from './loteadora-plantilla';

export type ResultadoEnvio = 'ok' | 'aviso' | 'error';

export interface EnvioRegistro {
  loteadoraId: number;
  loteadora: string;
  usuario: string | null;
  plantilla: string;
  articuloId: string;
  articuloDesc: string | null;
  /** Texto de cada campo tal como se envió */
  campos: { fieldId: number; texto: string }[];
  /** Lo rellenado en /loteadora: lote, cocida, caducidad, turno, datos a introducir... */
  datos: Record<string, unknown>;
  resultado: ResultadoEnvio;
  /** El aviso o el error, si lo hubo */
  mensaje: string | null;
  /**
   * La etiqueta tal como quedaba al enviar (trozosEtiqueta: cada línea con sus
   * trozos, el reloj marcado). Se guarda en el momento para que no cambie aunque se
   * edite la plantilla después. null en los envíos de antes de guardarla.
   */
  lineas: TrozoEtiqueta[][] | null;
}

export interface FilaRegistro extends EnvioRegistro { id: number; /** UTC, "AAAA-MM-DD HH:MM:SS" */ fecha: string }

export function registrarEnvio(db: Database.Database, e: EnvioRegistro): void {
  db.prepare(
    `INSERT INTO loteadora_envios (loteadora_id, loteadora, usuario, plantilla, articulo_id, articulo_desc, campos, datos, resultado, mensaje, lineas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(e.loteadoraId, e.loteadora, e.usuario, e.plantilla, e.articuloId, e.articuloDesc,
    JSON.stringify(e.campos), JSON.stringify(e.datos), e.resultado, e.mensaje, e.lineas ? JSON.stringify(e.lineas) : null);
}

export interface FiltrosRegistro {
  loteadoraId?: number;
  /** AAAA-MM-DD, en hora local */
  desde?: string;
  hasta?: string;
  usuario?: string;
  /** Busca en artículo, descripción, plantilla, lo enviado y lo rellenado (lote...) */
  q?: string;
  /** Desde 1 */
  pagina?: number;
}

export const POR_PAGINA = 50;

/** Envíos que cumplen los filtros, del más reciente al más antiguo, por páginas. */
export function buscarEnvios(db: Database.Database, f: FiltrosRegistro): { filas: FilaRegistro[]; total: number } {
  const donde: string[] = [];
  const args: (string | number)[] = [];
  if (f.loteadoraId) { donde.push('loteadora_id = ?'); args.push(f.loteadoraId); }
  if (f.desde) { donde.push("date(created_at, 'localtime') >= ?"); args.push(f.desde); }
  if (f.hasta) { donde.push("date(created_at, 'localtime') <= ?"); args.push(f.hasta); }
  if (f.usuario) { donde.push('usuario LIKE ?'); args.push(`%${f.usuario}%`); }
  if (f.q) {
    donde.push('(articulo_id LIKE ? OR articulo_desc LIKE ? OR plantilla LIKE ? OR campos LIKE ? OR datos LIKE ?)');
    args.push(...Array(5).fill(`%${f.q}%`));
  }
  const where = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM loteadora_envios ${where}`).get(...args) as { n: number }).n;
  const pagina = Math.max(1, f.pagina ?? 1);
  const filas = db.prepare(
    `SELECT id, created_at AS fecha, loteadora_id AS loteadoraId, loteadora, usuario, plantilla, articulo_id AS articuloId,
            articulo_desc AS articuloDesc, campos, datos, resultado, mensaje, lineas
     FROM loteadora_envios ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, POR_PAGINA, (pagina - 1) * POR_PAGINA) as (Omit<FilaRegistro, 'campos' | 'datos' | 'lineas'> & { campos: string; datos: string; lineas: string | null })[];
  return {
    filas: filas.map((r) => ({ ...r, campos: JSON.parse(r.campos), datos: JSON.parse(r.datos), lineas: r.lineas ? JSON.parse(r.lineas) : null })),
    total,
  };
}

/** Máquinas que aparecen en el registro (para el filtro), aunque ya no existan. */
export function maquinasDelRegistro(db: Database.Database): { id: number; nombre: string }[] {
  return db.prepare(
    `SELECT loteadora_id AS id, loteadora AS nombre FROM loteadora_envios
     WHERE id IN (SELECT MAX(id) FROM loteadora_envios GROUP BY loteadora_id) ORDER BY loteadora`
  ).all() as { id: number; nombre: string }[];
}
