// Panel /muestras — control de muestras de producto terminado enviadas a
// laboratorio/calidad (pendiente / enviado / completado). Ver ClickUp #869etmf6d.
//
// Origen de los lotes: producción real (F4111.ILDCT='IC') de artículos tipo "12"
// (F4101.IMSRP1='12', Producto terminado — mismo campo/valor que usa /coste-a1, ver
// docs/coste-a1.md §3.1) en el rango de fechas pedido, cruzados con F4108 (Lot Master)
// por código CORTO (F4111.ILITM = F4108.IOITM) para sacar el lote — evita pasar por
// F4101 para convertir corto↔largo. El artículo que se muestra es el código LARGO
// (F4111.ILLITM), igual que el resto del dashboard.
//
// El lote real de F4108.IORLOT puede venir en formato compuesto "AAJJJ-AAAAA": solo
// se usan los 5 primeros caracteres (petición explícita del usuario).
//
// Estado y observación NO viven en JDE — son una capa propia en SQLite
// (sample_tracking, clave (articulo, lote)) que se cruza aquí con el listado de JDE.
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from '@/lib/utils';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { getArticleAllowlist } from '@/lib/muestras';

const ESTADOS_VALIDOS = ['pendiente', 'enviado', 'completado'] as const;
type Estado = typeof ESTADOS_VALIDOS[number];

function jdeBoundsFromDates(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const startJde = 100000 + (start.getFullYear() - 2000) * 1000 + getDayOfYear(start);
  const endJde = 100000 + (end.getFullYear() - 2000) * 1000 + getDayOfYear(end);
  return { startJde, endJde };
}

interface MuestraRow { ARTICULO: string; DESCRIPCION: string; MARCA_COD: string; LOTE: string }
interface SampleTrackingRow { articulo: string; lote: string; estado: Estado; observacion: string }

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('muestras');
  if (denied) return denied;
  const startTime = Date.now();
  const session = await verifySession().catch(() => null);

  const { searchParams } = new URL(req.url);
  // Sin filtro de fechas por defecto: el listado por defecto es "Pendientes" (ver
  // muestras-table.tsx) y un pendiente no deja de serlo por ser antiguo — restringir
  // a los últimos 30 días por defecto escondía pendientes reales. Las fechas solo se
  // aplican si el usuario las elige explícitamente y pulsa "Filtrar".
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');
  const hasDateFilter = !!(startDateStr && endDateStr);

  let conn;
  try {
    conn = await getDbConnection();

    const sql = `
      SELECT DISTINCT
        TRIM(C.ILLITM) AS ARTICULO,
        TRIM(M.IMDSC1) AS DESCRIPCION,
        TRIM(M.IMSRP4) AS MARCA_COD,
        SUBSTR(TRIM(L.IORLOT), 1, 5) AS LOTE
      FROM F4111 C
      INNER JOIN F4101 M ON M.IMITM = C.ILITM AND TRIM(M.IMSRP1) = '12'
      INNER JOIN F4108 L ON L.IOITM = C.ILITM
      WHERE C.ILDCT = 'IC'
        ${hasDateFilter ? 'AND C.ILTRDJ BETWEEN :startJde AND :endJde' : ''}
        AND TRIM(L.IORLOT) IS NOT NULL
      ORDER BY ARTICULO, LOTE
    `;
    const binds = hasDateFilter ? jdeBoundsFromDates(startDateStr!, endDateStr!) : {};
    const result = await conn.execute(sql, binds);
    const rows = result.rows as MuestraRow[];

    // Descripción de marca (F4101.IMSRP4) contra el catálogo UDC 41/S4 — mismo
    // patrón que la familia en /mrp y /coste-a1.
    const marcaCatalogResult = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S4' AND TRIM(DRKY) IS NOT NULL`
    );
    const marcaDescMap = new Map(
      (marcaCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, r.DESCRIPCION])
    );

    // Capa propia de estado/observación (SQLite), cruzada por (articulo, lote).
    const db = getDb();
    const trackingRows = db.prepare('SELECT articulo, lote, estado, observacion FROM sample_tracking').all() as SampleTrackingRow[];
    const trackingMap = new Map(trackingRows.map((t) => [`${t.articulo}::${t.lote}`, t]));

    let muestras = rows.map((r) => {
      const tracking = trackingMap.get(`${r.ARTICULO}::${r.LOTE}`);
      return {
        articulo: r.ARTICULO,
        descripcion: r.DESCRIPCION,
        marca: marcaDescMap.get(r.MARCA_COD) || r.MARCA_COD || '',
        lote: r.LOTE,
        estado: tracking?.estado || 'pendiente',
        observacion: tracking?.observacion || '',
      };
    });

    // Lista global de artículos visibles (admin la ve siempre entera; para el resto,
    // si hay lista configurada, se restringe — ver docs/muestras.md §"Configuración").
    if (session?.role !== 'admin') {
      const allowlist = getArticleAllowlist();
      if (allowlist.length > 0) {
        const allowed = new Set(allowlist.map((a) => a.articulo));
        muestras = muestras.filter((m) => allowed.has(m.articulo));
      }
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
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
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
