// Panel /servicio — nivel de servicio (OTIF) de los pedidos de venta. Ver docs/servicio.md.
//
// Los datos de pedido salen de F4211 en directo (una fila por línea, partida por SSCC
// enviado) y se agrupan por (pedido, albarán SDDELN) en lib/servicio.ts. Lo que JDE no
// sabe (transportista, fecha de entrega real, incidencia...) vive en SQLite
// (order_service_tracking) y se cruza aquí en memoria, igual que /muestras.
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import {
  EJEMPLO_CANALES, TIPOS_PEDIDO, TIPO_LINEA_STOCK, armarRespuesta, cantidadesLinea, detectarDuplicados, esRestoDeReparto, generarEjemplo, isoAJde, jdeAIso,
  pedidosCanceladosEnteros, udsPorCaja, udsPorCajaDeLineas, totalAfectadas, validarAfectadasArticulos,
  type AfectadaArticulo, type ConversionUm, type LineaJde, type PedidoEnviado, type TipoPedido, type TrackingManual,
} from '@/lib/servicio';
import { valorPermitido } from '@/lib/servicio-catalogo';

// Solo pedidos de venta y muestras (SDDCTO) y solo líneas de stock (SDLNTY = 'S'): las líneas N
// (portes, cargos) nunca llevan albarán ni se envían. Ver docs/servicio.md §3.
const TIPOS_DOC = Object.keys(TIPOS_PEDIDO) as TipoPedido[];
const BINDS_TIPOS = Object.fromEntries(TIPOS_DOC.map((t, i) => [`tipo${i}`, t]));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IN = 900; // Oracle admite 1000 elementos en un IN

interface TrackingRow {
  pedido: number; albaran: number; transportista: string; fecha_entrega_real: string | null;
  responsable: string; motivo: string; incidencia: string; uds_afectadas: number; cajas_afectadas: number;
}

const hoyIso = () => new Date().toISOString().slice(0, 10);

// Datos manuales de todos los envíos, con su desglose de afectadas por artículo
function leerTracking(db: ReturnType<typeof getDb>): Map<string, TrackingManual> {
  const porEnvio = new Map<string, AfectadaArticulo[]>();
  for (const a of db.prepare('SELECT pedido, albaran, articulo, uds, cajas FROM order_service_incidencia_articulo').all() as (AfectadaArticulo & { pedido: number; albaran: number })[]) {
    const k = `${a.pedido}|${a.albaran}`;
    porEnvio.set(k, [...(porEnvio.get(k) ?? []), { articulo: a.articulo, uds: a.uds, cajas: a.cajas }]);
  }
  return new Map(
    (db.prepare('SELECT * FROM order_service_tracking').all() as TrackingRow[]).map((t) => {
      const k = `${t.pedido}|${t.albaran}`;
      return [k, { ...t, articulos: porEnvio.get(k) ?? [] }];
    })
  );
}

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('servicio');
  if (denied) return denied;
  const startTime = Date.now();
  const session = await verifySession().catch(() => null);

  // Rango sobre la fecha de entrega prometida (SDRSDJ). Por defecto, últimos 30 días.
  const { searchParams } = new URL(req.url);
  const hoy = hoyIso();
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const startDate = searchParams.get('startDate') ?? hace30;
  const endDate = searchParams.get('endDate') ?? hoy;
  if (!ISO.test(startDate) || !ISO.test(endDate) || startDate > endDate) {
    return NextResponse.json({ error: 'Rango de fechas inválido' }, { status: 400 });
  }

  // ?mock=1: entregas ficticias de ene–jul 2024 para ver los gráficos. Responde aquí y no
  // llega a abrir Oracle ni a leer/escribir SQLite. Solo por URL (como /compras?mock=1).
  if (searchParams.get('mock') === '1') {
    const ejemplo = generarEjemplo();
    return NextResponse.json({ ...armarRespuesta(ejemplo.lineas, ejemplo.tracking, EJEMPLO_CANALES, hoy), canalLabels: EJEMPLO_CANALES, startDate, endDate, mock: true });
  }

  let conn;
  try {
    conn = await getDbConnection();

    const result = await conn.execute(
      `SELECT A.SDDOCO, TRIM(A.SDDCTO) AS SDDCTO, TRIM(A.SDVR01) AS SDVR01, A.SDSHPN, A.SDDELN, A.SDAN8, A.SDSHAN,
              A.SDPDDJ, A.SDADDJ, A.SDRSDJ, A.SDUORG, A.SDSOQS, A.SDSOCN, A.SDSQOR, A.SDITM,
              TRIM(A.SDLITM) AS SDLITM, TRIM(A.SDDSC1) AS SDDSC1, TRIM(A.SDUOM) AS SDUOM, TRIM(A.SDUOM2) AS SDUOM2, TRIM(A.SDLTTR) AS SDLTTR,
              TRIM(B.ABALPH) AS AN8_DESC, TRIM(C.ABALPH) AS SHAN_DESC
       FROM F4211 A
       LEFT JOIN F0101 B ON B.ABAN8 = A.SDAN8
       LEFT JOIN F0101 C ON C.ABAN8 = A.SDSHAN
       WHERE TRIM(A.SDDCTO) IN (${TIPOS_DOC.map((_, i) => `:tipo${i}`).join(', ')})
         AND TRIM(A.SDLNTY) = :tipoLinea
         AND A.SDRSDJ BETWEEN :startJde AND :endJde`,
      { ...BINDS_TIPOS, tipoLinea: TIPO_LINEA_STOCK, startJde: isoAJde(startDate), endJde: isoAJde(endDate) }
    );
    // Fuera los restos intermedios del reparto por palet (980 sin unidades canceladas): no son pedido
    const rows = (result.rows as any[]).filter((r) => !esRestoDeReparto({ estado: String(r.SDLTTR || '').trim(), udsCanceladas: (r.SDSOCN || 0) / 100 }));

    // Canal del artículo (F554101.AAZE06, UDC 17/B6) — mismo origen que /compras: el
    // canal es atributo del artículo y un pedido tiene un solo canal.
    const items = [...new Set(rows.map((r) => String(r.SDITM).trim()))];
    const canalPorItem = new Map<string, string>();
    for (let i = 0; i < items.length; i += MAX_IN) {
      const chunk = items.slice(i, i + MAX_IN);
      const binds: Record<string, string> = {};
      chunk.forEach((it, j) => { binds[`i${j}`] = it; });
      const r = await conn.execute(
        `SELECT TRIM(AAITM) AS ITEM, TRIM(AAZE06) AS CANAL FROM F554101 WHERE AAITM IN (${chunk.map((_, j) => `:i${j}`).join(', ')})`,
        binds
      );
      for (const x of r.rows as any[]) if (x.CANAL) canalPorItem.set(String(x.ITEM).trim(), String(x.CANAL).trim());
    }
    const catalogo = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005
       WHERE TRIM(DRSY) = '17' AND TRIM(DRRT) = 'B6' AND TRIM(DRKY) IS NOT NULL`
    );
    // Conversiones de unidades de cada artículo (F41002, factor ÷10.000.000). Se traen todas: cada línea
    // usa la de su UM secundaria (caja, SDUOM2) a su UM principal (SDUOM), sea cual sea el código.
    const convPorItem = new Map<string, ConversionUm[]>();
    for (let i = 0; i < items.length; i += MAX_IN) {
      const chunk = items.slice(i, i + MAX_IN);
      const binds: Record<string, number> = {};
      chunk.forEach((it, j) => { binds[`c${j}`] = Number(it); });
      const r = await conn.execute(
        `SELECT UMITM, TRIM(UMUM) AS UMUM, TRIM(UMRUM) AS UMRUM, UMCONV FROM F41002
         WHERE UMITM IN (${chunk.map((_, j) => `:c${j}`).join(', ')})`,
        binds
      );
      for (const x of r.rows as any[]) {
        const k = String(x.UMITM).trim();
        convPorItem.set(k, [...(convPorItem.get(k) ?? []), { de: x.UMUM, a: x.UMRUM, factor: (x.UMCONV || 0) / 10000000 }]);
      }
    }
    const canalLabels: Record<string, string> = {};
    for (const x of catalogo.rows as any[]) canalLabels[String(x.CODE).trim()] = String(x.DESCRIPCION).trim();

    // Respaldo para artículos sin conversión en F41002: sus uds por caja según las líneas que traen
    // cantidad secundaria (SDSQOR), aplicadas a todas sus líneas (las canceladas vienen sin ella)
    const respaldoPorItem = udsPorCajaDeLineas(rows.map((r) => ({
      articulo: String(r.SDITM).trim(), udsPedidas: (r.SDUORG || 0) / 100, cajasSecundarias: (r.SDSQOR || 0) / 100,
    })));
    const udsPorCajaDe = (r: any) =>
      udsPorCaja(convPorItem.get(String(r.SDITM).trim()) ?? [], String(r.SDUOM2 || '').trim(), String(r.SDUOM || '').trim())
      ?? respaldoPorItem.get(String(r.SDITM).trim()) ?? null;

    const lineas: LineaJde[] = rows.map((r) => ({
      pedido: r.SDDOCO,
      tipoPedido: String(r.SDDCTO || '').trim(),
      suPedido: String(r.SDVR01 || '').trim(),
      albaran: r.SDDELN || 0,
      cliente: r.SDAN8 || 0,
      clienteNombre: String(r.AN8_DESC || '').trim(),
      destino: r.SDSHAN || 0,
      destinoNombre: String(r.SHAN_DESC || '').trim(),
      fechaEnvio: jdeAIso(r.SDADDJ),
      fechaPrometida: jdeAIso(r.SDRSDJ),
      udsPedidas: (r.SDUORG || 0) / 100,
      udsCanceladas: (r.SDSOCN || 0) / 100,
      // Enviadas solo si la línea ha salido (fecha de envío); cajas con las uds por caja de la línea
      ...cantidadesLinea({ udsPedidas: (r.SDUORG || 0) / 100, udsServidas: (r.SDSOQS || 0) / 100, fechaEnvio: jdeAIso(r.SDADDJ), udsPorCaja: udsPorCajaDe(r) }),
      canal: canalPorItem.get(String(r.SDITM).trim()) ?? null,
      articulo: String(r.SDLITM || r.SDITM || '').trim(),
      descripcion: String(r.SDDSC1 || '').trim(),
      // Uds por caja de la línea: también pasan a cajas las afectadas de cada artículo
      udsPorCaja: udsPorCajaDe(r),
    }));

    // Pedidos duplicados (uno enviado y otro cancelado entero, con la misma SDVR01): si el gemelo enviado de
    // un cancelado no está en el rango cargado, se busca aparte en F4211 sin filtro de fecha. Casi siempre
    // no hay ninguno y no se consulta. Ver docs/servicio.md §22.
    const enRango = detectarDuplicados(lineas);
    const sinGemelo = [...pedidosCanceladosEnteros(lineas)].filter(([pedido]) => !enRango.has(pedido)).map(([, c]) => c);
    const enviadosFuera: PedidoEnviado[] = [];
    for (let i = 0; i < sinGemelo.length; i += MAX_IN / 2) {
      const chunk = sinGemelo.slice(i, i + MAX_IN / 2);
      const binds: Record<string, string | number> = { tipoLinea: TIPO_LINEA_STOCK };
      chunk.forEach((c, j) => { binds[`a${j}`] = c.cliente; binds[`v${j}`] = c.suPedido; });
      const r = await conn.execute(
        `SELECT DISTINCT SDDOCO, SDAN8, TRIM(SDVR01) AS SDVR01 FROM F4211
         WHERE SDAN8 IN (${chunk.map((_, j) => `:a${j}`).join(', ')})
           AND TRIM(SDVR01) IN (${chunk.map((_, j) => `:v${j}`).join(', ')})
           AND TRIM(SDLNTY) = :tipoLinea AND SDADDJ > 0 AND SDSOQS > 0`,
        binds
      );
      for (const x of r.rows as any[]) enviadosFuera.push({ pedido: x.SDDOCO, cliente: x.SDAN8, suPedido: String(x.SDVR01 || '').trim() });
    }

    const db = getDb();
    const tracking = leerTracking(db);

    const { envios: enviosDto, kpis } = armarRespuesta(lineas, tracking, canalLabels, hoy, enviadosFuera);

    // Registrar consulta en logs (nunca bloquea la respuesta).
    try {
      db.prepare('INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)')
        .run(session?.id ?? null, session ? session.username : 'Invitado', 'servicio', JSON.stringify({ startDate, endDate }), enviosDto.length, Date.now() - startTime);
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({ envios: enviosDto, kpis, canalLabels, startDate, endDate });
  } catch (error) {
    console.error('Error en /api/servicio:', error);
    return NextResponse.json({ error: 'Error al consultar el nivel de servicio' }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}

// Guarda los datos manuales de un envío (pedido + albarán). Solo escribe en
// order_service_tracking (upsert); los campos que no vengan en el body se conservan.
export async function PATCH(req: NextRequest) {
  const denied = await requireScreenAccess('servicio');
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const user = await verifySession().catch(() => null);
  const pedido = Number(body?.pedido);
  const albaran = Number(body?.albaran);
  if (!Number.isInteger(pedido) || pedido <= 0 || !Number.isInteger(albaran) || albaran < 0) {
    return NextResponse.json({ error: 'Pedido o albarán inválido' }, { status: 400 });
  }

  const db = getDb();
  const actual = db.prepare('SELECT * FROM order_service_tracking WHERE pedido = ? AND albaran = ?').get(pedido, albaran) as TrackingRow | undefined;
  const next: TrackingRow = actual ?? { pedido, albaran, transportista: '', fecha_entrega_real: null, responsable: '', motivo: '', incidencia: '', uds_afectadas: 0, cajas_afectadas: 0 };

  // Motivo, responsable y transportista salen de las listas de /admin → Listas de servicio.
  // Se acepta vacío, un valor activo de la lista o el que el envío ya tenía (aunque luego se
  // haya desactivado).
  const previo = { transportista: next.transportista, responsable: next.responsable, motivo: next.motivo };
  if (body.transportista !== undefined) {
    if (typeof body.transportista !== 'string') return NextResponse.json({ error: 'Transportista inválido' }, { status: 400 });
    const t = body.transportista.trim().slice(0, 60);
    if (!valorPermitido('transportista', t, previo.transportista)) return NextResponse.json({ error: 'Transportista inválido' }, { status: 400 });
    next.transportista = t;
  }
  if (body.fechaEntregaReal !== undefined) {
    if (body.fechaEntregaReal !== null && !(typeof body.fechaEntregaReal === 'string' && ISO.test(body.fechaEntregaReal))) {
      return NextResponse.json({ error: 'Fecha de entrega real inválida' }, { status: 400 });
    }
    next.fecha_entrega_real = body.fechaEntregaReal;
  }
  if (body.responsable !== undefined) {
    if (typeof body.responsable !== 'string' || !valorPermitido('responsable', body.responsable, previo.responsable)) return NextResponse.json({ error: 'Responsable inválido' }, { status: 400 });
    next.responsable = body.responsable;
  }
  if (body.motivo !== undefined) {
    if (typeof body.motivo !== 'string' || !valorPermitido('motivo', body.motivo, previo.motivo)) return NextResponse.json({ error: 'Motivo inválido' }, { status: 400 });
    next.motivo = body.motivo;
  }
  if (body.incidencia !== undefined) {
    if (typeof body.incidencia !== 'string') return NextResponse.json({ error: 'Incidencia inválida' }, { status: 400 });
    next.incidencia = body.incidencia.trim().slice(0, 500);
  }
  if (body.udsAfectadas !== undefined) {
    const n = Number(body.udsAfectadas);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return NextResponse.json({ error: 'Unidades afectadas inválidas' }, { status: 400 });
    next.uds_afectadas = n;
  }
  if (body.cajasAfectadas !== undefined) {
    const n = Number(body.cajasAfectadas);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return NextResponse.json({ error: 'Cajas afectadas inválidas' }, { status: 400 });
    next.cajas_afectadas = Math.round(n * 10) / 10;
  }
  // Desglose por artículo: si viene, sustituye al anterior y el total del envío pasa a ser su suma
  // (manda sobre udsAfectadas / cajasAfectadas sueltos)
  let articulos: AfectadaArticulo[] | null = null;
  if (body.afectadasArticulos !== undefined) {
    articulos = validarAfectadasArticulos(body.afectadasArticulos);
    if (!articulos) return NextResponse.json({ error: 'Afectadas por artículo inválidas' }, { status: 400 });
    if (articulos.length > 0) {
      const t = totalAfectadas(articulos);
      next.uds_afectadas = t.uds;
      next.cajas_afectadas = t.cajas;
    }
  }

  try {
    // Datos del envío y desglose por artículo a la vez: o se guarda todo o nada
    db.transaction(() => {
      db.prepare(`
        INSERT INTO order_service_tracking (pedido, albaran, transportista, fecha_entrega_real, responsable, motivo, incidencia, uds_afectadas, cajas_afectadas, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(pedido, albaran) DO UPDATE SET
          transportista = excluded.transportista, fecha_entrega_real = excluded.fecha_entrega_real,
          responsable = excluded.responsable, motivo = excluded.motivo, incidencia = excluded.incidencia,
          uds_afectadas = excluded.uds_afectadas, cajas_afectadas = excluded.cajas_afectadas, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).run(pedido, albaran, next.transportista, next.fecha_entrega_real, next.responsable, next.motivo, next.incidencia, next.uds_afectadas, next.cajas_afectadas, user ? user.username : 'Invitado');
      if (articulos) {
        db.prepare('DELETE FROM order_service_incidencia_articulo WHERE pedido = ? AND albaran = ?').run(pedido, albaran);
        const alta = db.prepare('INSERT INTO order_service_incidencia_articulo (pedido, albaran, articulo, uds, cajas) VALUES (?, ?, ?, ?, ?)');
        for (const a of articulos) alta.run(pedido, albaran, a.articulo, a.uds, a.cajas);
      }
    })();
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error actualizando order_service_tracking:', err);
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 });
  }
}
