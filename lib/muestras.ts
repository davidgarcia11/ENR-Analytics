// Helpers compartidos entre app/api/muestras/route.ts, app/api/muestras/config/route.ts
// y app/api/admin/muestras-sync/route.ts. Viven aquí (no exportados desde un route.ts)
// porque Next.js solo permite exportar los nombres reservados (GET/POST/...) desde un
// archivo route.ts.
//
// Caché local de /muestras (ver docs/muestras.md §"Caché y sincronización"): el panel
// nunca consulta Oracle en directo para el listado — lee siempre de sample_candidates
// (SQLite).
//
// La sincronización trae SIEMPRE el histórico completo de los artículos que haya en
// sample_article_filter (la lista de "artículos visibles" que configura admin/
// responsable) — nunca "solo lo nuevo". No hace falta llevar marca de agua ni backfill
// por tramos: probado contra Oracle real que filtrar F4111 por un puñado de artículos
// concretos (los 10-15 que se van a configurar en la práctica) permite usar un índice
// que sin ese filtro no se usaba — hasta sin ningún límite de fecha, el histórico
// completo de unos pocos artículos tarda segundos, no minutos (con TODOS los artículos
// sin filtrar es cuando se dispara: ILDCT solo, sin combinar con artículo/fecha, obliga
// a repasar los ~544.000 movimientos "IC" de toda la empresa). Por eso:
//   - Si sample_article_filter está vacía, NO se sincroniza nada (sería la consulta
//     lenta/inestable de antes) — el panel avisa de que hay que configurar artículos.
//   - Si tiene artículos, se resincroniza TODO su histórico de una vez, cada vez que:
//     (a) cambia la lista (se añade/quita un artículo, ver api/muestras/config), y
//     (b) cada SYNC_INTERVAL_MS en segundo plano (setInterval de servidor, sin cron).
// Como siempre se trae el histórico completo (no un delta), nunca se puede "perder" una
// corrección tardía de JDE por antigua que sea la fecha que lleve — no hay margen ni
// campo de fecha del que depender para la corrección.
//
// El lote sale de F4111.ILLOTN directamente (formato "<SSCC>_<sufijo>", los 5 primeros
// caracteres tras el "_" son el lote) — NO se cruza con F4108: ese cruce, sin ningún
// filtro de fecha en el lado del lote, es un cuello de botella aparte. La marca se
// resuelve con una consulta suelta al catálogo F0005 (tabla pequeña) en vez de un LEFT
// JOIN por fila — mismo motivo. Ver ClickUp #869etmf6d.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { getDbConnection } from '@/lib/db';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 min de fondo — además, se dispara solo al cambiar la lista de artículos

interface SyncStateRow {
  last_synced_at: string | null;
  candidatos_sincronizados: number;
  last_error: string | null;
}

export function getSyncState(): SyncStateRow {
  const db = getDb();
  return db.prepare('SELECT last_synced_at, candidatos_sincronizados, last_error FROM sample_sync_state WHERE id = 1').get() as SyncStateRow;
}

function updateSyncState(patch: Partial<SyncStateRow>) {
  const db = getDb();
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const set = fields.map((f) => `${f} = ?`).join(', ');
  db.prepare(`UPDATE sample_sync_state SET ${set} WHERE id = 1`).run(...fields.map((f) => (patch as any)[f]));
}

interface CandidateRow { ARTICULO: string; DESCRIPCION: string; MARCA_COD: string; LOTE: string; FECHA_JDE: number }

export type SyncTrigger = 'scheduled' | 'config-change' | 'manual';

interface SyncMeta {
  trigger: SyncTrigger;
  userId?: number | null;
  username?: string | null;
}

// Registra CADA sincronización (no solo la última) en query_logs — mismo sistema de
// logs que el resto de paneles (/admin/logs), fuente propia 'muestras-sync' para no
// mezclarla con 'muestras' (que registra vistas del panel, no sincronizaciones).
// Nunca bloquea ni rompe runFullSync si falla — mismo criterio que el resto del proyecto.
function logSyncRun(meta: SyncMeta, result: { ok: boolean; rows?: number; error?: string }, durationMs: number, articulosConfigurados: number) {
  try {
    const db = getDb();
    const filters = { trigger: meta.trigger, articulosConfigurados, error: result.error ?? null };
    const username = meta.username || (meta.trigger === 'scheduled' ? 'Sistema (automático)' : 'Invitado');
    db.prepare(
      'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(meta.userId ?? null, username, 'muestras-sync', JSON.stringify(filters), result.rows ?? 0, durationMs);
  } catch (logErr) {
    console.error('Error registrando log de sincronización de muestras:', logErr);
  }
}

// Sincronización completa: todo el histórico de los artículos configurados en
// sample_article_filter. Si la lista está vacía, no hace nada (sería la consulta
// lenta/inestable sin filtrar por artículo — ver comentario de cabecera) — y no se
// registra en el log, no ha pasado nada que valga la pena contar.
export async function runFullSync(meta: SyncMeta = { trigger: 'scheduled' }): Promise<{ ok: boolean; rows?: number; error?: string }> {
  const allowlist = getArticleAllowlist();
  if (allowlist.length === 0) {
    return { ok: true, rows: 0 };
  }

  const startTime = Date.now();
  let conn;
  try {
    conn = await getDbConnection();
    const placeholders = allowlist.map((_, i) => `:a${i}`).join(', ');
    const binds: Record<string, string> = {};
    allowlist.forEach((a, i) => { binds[`a${i}`] = a.articulo; });

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
        AND TRIM(C.ILLITM) IN (${placeholders})
        AND INSTR(TRIM(C.ILLOTN), '_') > 0
    `;
    const result = await conn.execute(sql, binds);
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

    const total = (db.prepare('SELECT COUNT(*) AS n FROM sample_candidates').get() as { n: number }).n;
    updateSyncState({ last_synced_at: new Date().toISOString(), candidatos_sincronizados: total, last_error: null });
    const outcome = { ok: true, rows: rows.length };
    logSyncRun(meta, outcome, Date.now() - startTime, allowlist.length);
    return outcome;
  } catch (err: any) {
    const message = String(err?.message || err);
    console.error('[muestras] Error sincronizando:', err);
    updateSyncState({ last_error: message });
    const outcome = { ok: false, error: message };
    logSyncRun(meta, outcome, Date.now() - startTime, allowlist.length);
    return outcome;
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}

// Registra el repaso periódico de fondo (una sola vez por proceso de servidor — sin
// cron externo, este proyecto no tiene nada así montado). Se llama de forma barata e
// idempotente desde GET /api/muestras.
let schedulerStarted = false;

export function ensureSyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setInterval(() => { runFullSync({ trigger: 'scheduled' }).catch((err) => console.error('[muestras] sync programado falló:', err)); }, SYNC_INTERVAL_MS);
}

// Lista global de artículos visibles en /muestras (si está vacía, no hay nada
// sincronizado todavía — ver comentario de cabecera).
export function getArticleAllowlist(): { articulo: string; descripcion: string }[] {
  const db = getDb();
  return db.prepare('SELECT articulo, descripcion FROM sample_article_filter ORDER BY articulo').all() as { articulo: string; descripcion: string }[];
}

// Acceso a la configuración de artículos: admin, o cualquier usuario con el permiso
// 'muestras.config' (user_permissions, asignado por admin desde /admin → Usuarios).
// La regla vive en lib/permissions.ts junto al resto de criterios de acceso;
// esto es solo el nombre con el que la conocen las rutas de /muestras.
export async function requireMuestrasConfigAccess(): Promise<NextResponse | null> {
  const acceso = await requireAccess({ permiso: 'muestras.config' });
  return acceso.ok ? null : acceso.denied;
}
