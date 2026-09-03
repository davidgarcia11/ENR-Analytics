// Panel /muestras — control de muestras de producto terminado enviadas a
// laboratorio/calidad (pendiente / enviado / completado). Ver ClickUp #869etmf6d.
//
// El listado NUNCA consulta Oracle en directo — lee de sample_candidates (SQLite),
// una caché local de qué combinaciones artículo+lote ha producido JDE (F4111.ILDCT='IC',
// F4101.IMSRP1='12' = Producto terminado), mantenida al día por lib/muestras.ts
// (backfill histórico a mano desde /admin + repaso incremental automático cada 30 min).
// Ver docs/muestras.md §"Caché y sincronización" para el porqué (una consulta en vivo
// sin acotar por fecha rompe la conexión a Oracle; acotada sigue costando varios
// segundos por el cruce a F4108, que aquí ya no hace falta).
//
// Estado y observación NO viven en JDE — son una capa propia en SQLite
// (sample_tracking, clave (articulo, lote)) que se cruza aquí con la caché de JDE.
import { NextRequest, NextResponse } from 'next/server';
import { getDayOfYear } from '@/lib/utils';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getArticleAllowlist, ensureSyncScheduler } from '@/lib/muestras';

const ESTADOS_VALIDOS = ['pendiente', 'enviado', 'completado'] as const;
type Estado = typeof ESTADOS_VALIDOS[number];

function jdeBoundsFromDates(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const startJde = 100000 + (start.getFullYear() - 2000) * 1000 + getDayOfYear(start);
  const endJde = 100000 + (end.getFullYear() - 2000) * 1000 + getDayOfYear(end);
  return { startJde, endJde };
}

interface CandidateRow { articulo: string; lote: string; descripcion: string; marca: string; fecha_jde: number | null }
interface SampleTrackingRow { articulo: string; lote: string; estado: Estado; observacion: string }

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('muestras');
  if (denied) return denied;
  ensureSyncScheduler();
  const startTime = Date.now();
  const session = await verifySession().catch(() => null);

  const { searchParams } = new URL(req.url);
  // Sin filtro de fechas por defecto: el listado por defecto es "Pendientes" (ver
  // muestras-table.tsx) y un pendiente no deja de serlo por ser antiguo. Las fechas
  // solo se aplican si el usuario las elige explícitamente y pulsa "Filtrar" — y como
  // ahora se filtra sobre la caché local, no vuelve a tocar Oracle para eso.
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');
  const hasDateFilter = !!(startDateStr && endDateStr);

  try {
    const db = getDb();
    const candidateRows = db.prepare('SELECT articulo, lote, descripcion, marca, fecha_jde FROM sample_candidates').all() as CandidateRow[];

    let rows = candidateRows;
    if (hasDateFilter) {
      const { startJde, endJde } = jdeBoundsFromDates(startDateStr!, endDateStr!);
      rows = rows.filter((r) => r.fecha_jde != null && r.fecha_jde >= startJde && r.fecha_jde <= endJde);
    }

    // Capa propia de estado/observación (SQLite), cruzada por (articulo, lote).
    const trackingRows = db.prepare('SELECT articulo, lote, estado, observacion FROM sample_tracking').all() as SampleTrackingRow[];
    const trackingMap = new Map(trackingRows.map((t) => [`${t.articulo}::${t.lote}`, t]));

    let muestras = rows.map((r) => {
      const tracking = trackingMap.get(`${r.articulo}::${r.lote}`);
      return {
        articulo: r.articulo,
        descripcion: r.descripcion,
        marca: r.marca,
        lote: r.lote,
        estado: tracking?.estado || 'pendiente',
        observacion: tracking?.observacion || '',
      };
    });

    // Lista global de artículos visibles — se aplica a TODO el mundo, admin incluido
    // (petición explícita: si se ha configurado una lista, es porque eso es lo que se
    // quiere ver, también quien la configuró — no tiene sentido que admin siga viendo
    // el universo entero). Sin excepción de rol aquí, a diferencia de otras pantallas.
    const allowlist = getArticleAllowlist();
    if (allowlist.length > 0) {
      const allowed = new Set(allowlist.map((a) => a.articulo));
      muestras = muestras.filter((m) => allowed.has(m.articulo));
    }

    const resumen = {
      total: muestras.length,
      pendientes: muestras.filter((m) => m.estado === 'pendiente').length,
      enviados: muestras.filter((m) => m.estado === 'enviado').length,
      completados: muestras.filter((m) => m.estado === 'completado').length,
    };

    // Registrar consulta en logs (nunca bloquea la respuesta) — mismo patrón que el resto de paneles.
    try {
      const filters = hasDateFilter ? { startDate: startDateStr, endDate: endDateStr } : { startDate: null, endDate: null };
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(session?.id ?? null, session ? session.username : 'Invitado', 'muestras', JSON.stringify(filters), muestras.length, Date.now() - startTime);
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({ muestras, resumen });
  } catch (error) {
    console.error('Error en /api/muestras:', error);
    return NextResponse.json({ error: 'Error al consultar las muestras' }, { status: 500 });
  }
}

function upsertOne(db: ReturnType<typeof getDb>, articulo: string, lote: string, estado: Estado | undefined, observacion: string | undefined, username: string) {
  const existing = db.prepare('SELECT estado, observacion FROM sample_tracking WHERE articulo = ? AND lote = ?').get(articulo, lote) as { estado: Estado; observacion: string } | undefined;
  const nextEstado = estado ?? existing?.estado ?? 'pendiente';
  const nextObservacion = observacion ?? existing?.observacion ?? '';

  db.prepare(`
    INSERT INTO sample_tracking (articulo, lote, estado, observacion, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(articulo, lote) DO UPDATE SET
      estado = excluded.estado,
      observacion = excluded.observacion,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(articulo, lote, nextEstado, nextObservacion, username);
}

function validItem(v: any): v is { articulo: string; lote: string } {
  return typeof v?.articulo === 'string' && v.articulo.trim().length > 0 && v.articulo.length <= 20
    && typeof v?.lote === 'string' && v.lote.trim().length > 0 && v.lote.length <= 10;
}

// Actualiza estado y/o observación de un lote (o de varios a la vez, con `items`).
// No borra JDE: solo escribe en la capa propia sample_tracking (upsert por clave
// natural articulo+lote). La actualización masiva (selección múltiple en la tabla)
// solo cambia estado — la observación siempre es individual, por fila.
export async function PATCH(req: NextRequest) {
  const denied = await requireScreenAccess('muestras');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const user = await verifySession().catch(() => null);
  const username = user ? user.username : 'Invitado';
  const db = getDb();

  // Modo masivo: { items: [{articulo, lote}, ...], estado }
  if (Array.isArray(body?.items)) {
    const estado = body?.estado;
    if (!ESTADOS_VALIDOS.includes(estado)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    }
    const items = body.items.filter(validItem);
    if (items.length === 0) {
      return NextResponse.json({ error: 'Sin lotes válidos' }, { status: 400 });
    }
    if (items.length > 2000) {
      return NextResponse.json({ error: 'Demasiados lotes de una vez' }, { status: 400 });
    }

    try {
      const tx = db.transaction((rows: { articulo: string; lote: string }[]) => {
        for (const it of rows) upsertOne(db, it.articulo.trim(), it.lote.trim(), estado, undefined, username);
      });
      tx(items);
      return NextResponse.json({ ok: true, actualizados: items.length });
    } catch (err: any) {
      console.error('Error actualizando sample_tracking (masivo):', err);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // Modo individual: { articulo, lote, estado?, observacion? }
  const articulo = typeof body?.articulo === 'string' ? body.articulo.trim() : '';
  const lote = typeof body?.lote === 'string' ? body.lote.trim() : '';
  const estado = body?.estado;
  const observacion = typeof body?.observacion === 'string' ? body.observacion.trim().slice(0, 500) : undefined;

  if (!articulo || articulo.length > 20 || !lote || lote.length > 10) {
    return NextResponse.json({ error: 'Artículo o lote inválido' }, { status: 400 });
  }
  if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
    return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
  }
  if (estado === undefined && observacion === undefined) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
  }

  try {
    upsertOne(db, articulo, lote, estado, observacion, username);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error actualizando sample_tracking:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
