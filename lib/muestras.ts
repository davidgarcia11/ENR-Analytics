// Helpers compartidos entre app/api/muestras/route.ts, app/api/muestras/config/route.ts
// y app/api/admin/muestras-backfill/route.ts. Viven aquí (no exportados desde un
// route.ts) porque Next.js solo permite exportar los nombres reservados (GET/POST/...)
// desde un archivo route.ts.
//
// Caché local de /muestras (ver docs/muestras.md §"Caché y sincronización"): el panel
// nunca consulta Oracle en directo para el listado — lee siempre de sample_candidates
// (SQLite), que se mantiene al día con dos mecanismos:
//   1. Backfill histórico — una vez, por trozos, disparado a mano desde /admin.
//   2. Sincronización incremental — automática, cada SYNC_INTERVAL_MS, en segundo
//      plano (setInterval de servidor, sin cron externo).
//
// Marca de agua: F4111.ILTRDJ, NO ILCRDJ. En teoría ILCRDJ (fecha real de creación,
// nunca retrocede) era la elección correcta para no perder correcciones tardías (una
// producción de ayer registrada hoy). Probado contra Oracle real: filtrar por ILCRDJ
// es sistemáticamente lento — 60-70s incluso para 1 solo día y 0 filas, sea cual sea
// el rango — mientras que ILTRDJ es rápido (<1s) en los mismos casos. No hay forma de
// saber por qué sin acceso de DBA (probablemente estadísticas/índices de esa columna).
// Con ILTRDJ + un margen de solape hacia atrás (SYNC_LOOKBACK_DAYS) en cada
// sincronización incremental se cubre el caso real que preocupaba (correcciones de
// los últimos días) sin pagar el coste de ILCRDJ. Una corrección más antigua que el
// margen solo se recuperaría con un "Volver a sincronizar" manual desde /admin — ver
// docs/muestras.md.
//
// El lote sale de F4111.ILLOTN directamente (formato "<SSCC>_<sufijo>", los 5 primeros
// caracteres tras el "_" son el lote) — NO se cruza con F4108: ese cruce, sin ningún
// filtro de fecha en el lado del lote, es el cuello de botella real (comprobado: same
// day sin F4108 = 0,3s: con F4108 = 13,6s). La marca se resuelve con una consulta
// aparte al catálogo F0005 (tabla pequeña) en vez de un LEFT JOIN por fila — el JOIN
// por fila tiene el mismo problema que F4108 (70s en un tramo de 90 días). Ver
// ClickUp #869etmf6d.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear, parseJdeDate } from '@/lib/utils';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min — ver docs/muestras.md, no hace falta más frecuente
const SYNC_LOOKBACK_DAYS = 14; // margen hacia atrás en cada sync incremental, para correcciones tardías recientes
const BACKFILL_START = '2018-01-01'; // "desde el inicio de JDE" — ajustar si hiciera falta más atrás
const BACKFILL_CHUNK_DAYS = 60; // conservador: 90-180 días ya se vuelve inestable en este Oracle

interface SyncStateRow {
  last_synced_jde: number;
  backfill_cursor_jde: number;
  backfill_status: 'pending' | 'running' | 'completed' | 'failed';
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
  backfill_progress: string | null;
  backfill_error: string | null;
  candidatos_sincronizados: number;
}

function jdeFromDate(d: Date): number {
  return 100000 + (d.getFullYear() - 2000) * 1000 + getDayOfYear(d);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000);
}

// La conexión a Oracle de este entorno da algún corte transitorio de vez en cuando
// (visto en pruebas: NJS-500/NJS-510). Un par de reintentos con pausa corta evita que
// un tramo suelto tumbe todo un backfill de horas por un hipo de red puntual.
async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export function getSyncState(): SyncStateRow {
  const db = getDb();
  return db.prepare('SELECT * FROM sample_sync_state WHERE id = 1').get() as SyncStateRow;
}

function updateSyncState(patch: Partial<SyncStateRow>) {
  const db = getDb();
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE sample_sync_state SET ${set} WHERE id = 1`).run(...fields.map((f) => (patch as any)[f]));
}

interface CandidateRow { ARTICULO: string; DESCRIPCION: string; MARCA_COD: string; LOTE: string; FECHA_JDE: number }

// Consulta a Oracle de un tramo [startJde, endJde] (por ILTRDJ) y vuelca el resultado
// en sample_candidates. Devuelve cuántas filas distintas trajo el tramo.
async function syncChunk(startJde: number, endJde: number): Promise<{ rows: number }> {
  let conn;
  try {
    conn = await getDbConnection();
    const sql = `
      SELECT DISTINCT
        TRIM(C.ILLITM) AS ARTICULO,
        TRIM(M.IMDSC1) AS DESCRIPCION,
        TRIM(M.IMSRP4) AS MARCA_COD,
        SUBSTR(TRIM(C.ILLOTN), INSTR(TRIM(C.ILLOTN), '_') + 1, 5) AS LOTE,
        C.ILTRDJ AS FECHA_JDE
      FROM F4111 C
      INNER JOIN F4101 M ON M.IMITM = C.ILITM AND TRIM(M.IMSRP1) = '12'
      WHERE C.ILDCT = 'IC'
        AND C.ILTRDJ BETWEEN :s AND :e
        AND INSTR(TRIM(C.ILLOTN), '_') > 0
    `;
    const result = await conn.execute(sql, { s: startJde, e: endJde });
    const rows = result.rows as CandidateRow[];

    let marcaDescMap = new Map<string, string>();
    if (rows.length > 0) {
      const marcaCatalogResult = await conn.execute(
        `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S4' AND TRIM(DRKY) IS NOT NULL`
      );
      marcaDescMap = new Map((marcaCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, r.DESCRIPCION]));
    }

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO sample_candidates (articulo, lote, descripcion, marca, fecha_jde, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(articulo, lote) DO UPDATE SET
        descripcion = excluded.descripcion,
        marca = excluded.marca,
        fecha_jde = excluded.fecha_jde,
        updated_at = excluded.updated_at
    `);
    const tx = db.transaction((rs: CandidateRow[]) => {
      for (const r of rs) upsert.run(r.ARTICULO, r.LOTE, r.DESCRIPCION || '', marcaDescMap.get(r.MARCA_COD) || r.MARCA_COD || '', r.FECHA_JDE);
    });
    tx(rows);

    return { rows: rows.length };
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}

// Sincronización incremental: re-escanea desde (última vez - SYNC_LOOKBACK_DAYS) hasta
// hoy — el solape cubre correcciones tardías recientes (ver comentario de cabecera).
// Barata en este Oracle con ILTRDJ — pensada para llamarse a menudo (cada 30 min).
export async function runIncrementalSync(): Promise<void> {
  const state = getSyncState();
  const today = new Date();
  const todayJde = jdeFromDate(today);
  const start = state.last_synced_jde > 0
    ? addDays(new Date(), -SYNC_LOOKBACK_DAYS) // aproximación por días naturales, suficiente aquí
    : new Date(BACKFILL_START);
  const startJde = jdeFromDate(start);

  try {
    const { rows } = await withRetries(() => syncChunk(startJde, todayJde));
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS n FROM sample_candidates').get() as { n: number }).n;
    updateSyncState({ last_synced_jde: todayJde, candidatos_sincronizados: total });
    if (rows > 0) console.log(`[muestras] sincronización incremental: ${rows} filas nuevas/actualizadas`);
  } catch (err) {
    console.error('[muestras] Error en sincronización incremental:', err);
  }
}

// Backfill histórico — una sola vez, disparado a mano desde /admin. Va por tramos de
// BACKFILL_CHUNK_DAYS días (rangos más anchos se han visto inestables en este Oracle,
// ver docs/muestras.md) desde BACKFILL_START hasta hoy.
//
// Progreso en backfill_cursor_jde, un campo PROPIO (no last_synced_jde, que es la
// marca de agua del repaso incremental — compartirlo haría que el repaso de fondo,
// que solo mira los últimos días, "adelantara" sin querer el backfill y se saltara
// todo el histórico pendiente al reanudarlo).
//
// Reanudación: si el intento anterior quedó 'failed' a mitad, retoma desde
// backfill_cursor_jde. Si ya estaba 'completed' (botón "Volver a sincronizar") o es
// la primera vez, empieza de nuevo desde BACKFILL_START — ese botón sirve también de
// resincronización manual completa para recuperar correcciones más antiguas que el
// margen del repaso incremental.
let backfillRunning = false;

export async function runBackfill(): Promise<void> {
  if (backfillRunning) return; // guarda en memoria — evita dos backfills a la vez en el mismo proceso
  backfillRunning = true;

  const db = getDb();
  const state = getSyncState();
  const resuming = state.backfill_status === 'failed' && state.backfill_cursor_jde > 0;
  const resumeFrom = resuming ? parseJdeDate(state.backfill_cursor_jde)?.date : null;
  const start = resumeFrom ?? new Date(BACKFILL_START);
  const today = new Date();
  const totalChunks = Math.max(1, Math.ceil((today.getTime() - start.getTime()) / (BACKFILL_CHUNK_DAYS * 86400000)));

  updateSyncState({
    backfill_status: 'running',
    backfill_started_at: new Date().toISOString(),
    backfill_completed_at: null,
    backfill_error: null,
    backfill_cursor_jde: jdeFromDate(start),
    backfill_progress: `0 / ${totalChunks} tramos${resuming ? ' (retomando)' : ''}`,
  });

  try {
    let cursor = start;
    let chunkIndex = 0;
    while (cursor < today) {
      chunkIndex++;
      const chunkEnd = new Date(Math.min(addDays(cursor, BACKFILL_CHUNK_DAYS).getTime(), today.getTime()));
      const startJde = jdeFromDate(cursor);
      const endJde = jdeFromDate(chunkEnd);

      await withRetries(() => syncChunk(startJde, endJde));

      const total = (db.prepare('SELECT COUNT(*) AS n FROM sample_candidates').get() as { n: number }).n;
      updateSyncState({
        backfill_cursor_jde: endJde,
        candidatos_sincronizados: total,
        backfill_progress: `${chunkIndex} / ${totalChunks} tramos (hasta ${chunkEnd.toISOString().slice(0, 10)})`,
      });

      cursor = chunkEnd;
    }

    updateSyncState({ backfill_status: 'completed', backfill_completed_at: new Date().toISOString(), backfill_cursor_jde: 0 });
  } catch (err: any) {
    console.error('[muestras] Error en backfill:', err);
    // backfill_cursor_jde ya quedó guardado hasta el último tramo completado con
    // éxito — un reintento (botón "Sincronizar histórico" otra vez) retoma desde ahí.
    updateSyncState({ backfill_status: 'failed', backfill_error: String(err?.message || err) });
  } finally {
    backfillRunning = false;
  }
}

// Registra el repaso periódico de fondo (una sola vez por proceso de servidor — sin
// cron externo, este proyecto no tiene nada así montado). Se llama de forma barata e
// idempotente desde GET /api/muestras.
let schedulerStarted = false;

export function ensureSyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => { runIncrementalSync().catch((err) => console.error('[muestras] sync programado falló:', err)); }, SYNC_INTERVAL_MS);
}

// Lista global de artículos visibles en /muestras (si está vacía, se ven todos).
export function getArticleAllowlist(): { articulo: string; descripcion: string }[] {
  const db = getDb();
  return db.prepare('SELECT articulo, descripcion FROM sample_article_filter ORDER BY articulo').all() as { articulo: string; descripcion: string }[];
}

// Acceso a la configuración de artículos: admin, o cualquier usuario con
// users.can_configure_muestras = 1 (permiso suelto asignado por admin desde /admin).
export async function requireMuestrasConfigAccess(): Promise<NextResponse | null> {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.role === 'admin') return null;
  const db = getDb();
  const row = db.prepare('SELECT can_configure_muestras FROM users WHERE id = ?').get(session.id) as { can_configure_muestras: number } | undefined;
  if (!row?.can_configure_muestras) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  return null;
}
