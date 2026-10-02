// Seguimiento de conexión de las loteadoras en segundo plano: un ping a cada loteadora
// habilitada cada 30 s, desde el servidor (aunque nadie tenga la app abierta), y un
// log en loteadora_ping con cada cambio (Con conexión ↔ Sin conexión) y, si no
// cambia, una fila cada 30 min para que se vea que el seguimiento seguía activo. Al
// arrancar el servidor se guarda "Seguimiento iniciado": el hueco anterior es del
// servidor, no de la máquina. Se exporta en CSV desde /admin → Máquinas.
//
// Es un ping (ICMP), no el comando de estado: solo dice si responde en la red, pero
// no ocupa la única conexión TCP que admite la máquina ni retrasa los envíos. Lo
// arranca instrumentation.ts. Ver docs/loteadora.md §20.
import { execFile } from 'child_process';
import type Database from 'better-sqlite3';

export const INTERVALO_MS = 30_000;
export const REPETIR_MS = 30 * 60_000;

export type EstadoPing = 'conexion' | 'sin_conexion' | 'inicio';
export const ETIQUETA_PING: Record<EstadoPing, string> = {
  conexion: 'Con conexión',
  sin_conexion: 'Sin conexión',
  inicio: 'Seguimiento iniciado',
};

/** Lee la salida del ping (Windows o Linux): si respondió y en cuántos ms. */
export function leerPing(salida: string): { ok: boolean; ms: number | null } {
  if (!/TTL=/i.test(salida)) return { ok: false, ms: null };
  const m = salida.match(/(?:tiempo|time)\s*([=<])\s*(\d+(?:[.,]\d+)?)/i);
  return { ok: true, ms: m ? (m[1] === '<' ? 0 : Math.round(Number(m[2].replace(',', '.')))) : null };
}

export function hacerPing(ip: string): Promise<{ ok: boolean; ms: number | null }> {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', '1000', ip] : ['-c', '1', '-W', '1', ip];
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: 5000, windowsHide: true }, (_err, stdout) => resolve(leerPing(String(stdout ?? ''))));
  });
}

/** ¿Hay que guardar fila? Si cambia el estado, o si lleva REPETIR_MS sin guardar. */
export function debeRegistrar(ultimo: { estado: EstadoPing; at: number } | undefined, estado: EstadoPing, ahora: number): boolean {
  return !ultimo || ultimo.estado !== estado || ahora - ultimo.at >= REPETIR_MS;
}

export function registrarPing(
  db: Database.Database, l: { id: number; name: string; ip: string }, estado: EstadoPing, ms: number | null,
): void {
  db.prepare('INSERT INTO loteadora_ping (loteadora_id, loteadora, ip, estado, ms) VALUES (?, ?, ?, ?, ?)')
    .run(l.id, l.name, l.ip, estado, ms);
}

// Última fila guardada de cada loteadora (en memoria del proceso)
const ultimos = new Map<number, { estado: EstadoPing; at: number }>();

async function ciclo(db: Database.Database) {
  const loteadoras = db.prepare('SELECT id, name, ip FROM loteadoras WHERE enabled = 1 AND ip IS NOT NULL AND ip != \'\'').all() as
    { id: number; name: string; ip: string }[];
  await Promise.all(loteadoras.map(async (l) => {
    const { ok, ms } = await hacerPing(l.ip);
    const estado: EstadoPing = ok ? 'conexion' : 'sin_conexion';
    const ahora = Date.now();
    if (!debeRegistrar(ultimos.get(l.id), estado, ahora)) return;
    registrarPing(db, l, estado, ms);
    ultimos.set(l.id, { estado, at: ahora });
  }));
}

/**
 * Arranca el seguimiento (una sola vez por proceso). En desarrollo no, salvo con
 * LOTEADORA_PING=1 (si no, el PC de desarrollo haría ping a las máquinas de su BD).
 */
export function arrancarSeguimiento(getDb: () => Database.Database): void {
  const g = globalThis as { __seguimientoPing?: boolean };
  if (g.__seguimientoPing) return;
  if (process.env.NODE_ENV !== 'production' && process.env.LOTEADORA_PING !== '1') return;
  g.__seguimientoPing = true;

  const db = getDb();
  for (const l of db.prepare("SELECT id, name, ip FROM loteadoras WHERE enabled = 1 AND ip IS NOT NULL AND ip != ''").all() as
    { id: number; name: string; ip: string }[]) {
    registrarPing(db, l, 'inicio', null);
  }
  let enCurso = false;
  const vuelta = async () => {
    if (enCurso) return; // ponytail: si un ciclo tarda más de 30 s, el siguiente se salta
    enCurso = true;
    try { await ciclo(db); } catch (e) { console.error('[seguimiento ping] error:', e); } finally { enCurso = false; }
  };
  vuelta();
  setInterval(vuelta, INTERVALO_MS);
  console.log('[seguimiento ping] activo: cada 30 s a las loteadoras habilitadas');
}

/** Historial de una loteadora en CSV (separado por ";" y con BOM, para Excel en español). */
export function historialCsv(db: Database.Database, loteadoraId: number): string {
  const filas = db.prepare(
    `SELECT datetime(fecha, 'localtime') AS fecha, estado, ms, ip FROM loteadora_ping WHERE loteadora_id = ? ORDER BY id`
  ).all(loteadoraId) as { fecha: string; estado: EstadoPing; ms: number | null; ip: string }[];
  const lineas = ['Fecha;Estado;Respuesta (ms);IP', ...filas.map((f) => `${f.fecha};${ETIQUETA_PING[f.estado]};${f.ms ?? ''};${f.ip}`)];
  return '﻿' + lineas.join('\r\n') + '\r\n';
}
