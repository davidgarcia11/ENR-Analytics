// Cálculo del nivel de servicio (OTIF) de /servicio. Lógica pura, sin Oracle ni SQLite,
// para poder probarla (ver __tests__/servicio.test.ts) y para que API y UI usen la misma.
// Documentación: docs/servicio.md.

// Listas cerradas para los campos manuales (el Excel original eran textos libres con
// valores combinados tipo "Elaborados/Stef"). Ver docs/servicio.md §5.
export const MOTIVOS = ['Calidad', 'Preparación', 'Producción', 'Cajas rotas', 'Cliente', 'Back office', 'Transporte', 'Comercial', 'Expediciones', 'Servicio', 'Otros'] as const;
export const RESPONSABLES = ['Elaborados', 'Transportista', 'Cliente', 'Otros'] as const;

// Listas editables en /admin → Listas de servicio (lib/servicio-catalogo.ts). Las constantes
// MOTIVOS y RESPONSABLES de arriba son solo la carga inicial de esas listas.
export const TIPOS_CATALOGO = ['motivo', 'responsable', 'transportista'] as const;
export type TipoCatalogo = typeof TIPOS_CATALOGO[number];
export const TIPO_CATALOGO_LABEL: Record<TipoCatalogo, string> = { motivo: 'Motivos', responsable: 'Responsables', transportista: 'Transportistas' };

/** Nombre válido de una opción del catálogo: sin caracteres de control, espacios colapsados, 1–40 caracteres. */
export function limpiarNombreCatalogo(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return n.length >= 1 && n.length <= 40 ? n : null;
}

export interface ConversionUm {
  de: string; // F41002.UMUM
  a: string; // F41002.UMRUM
  factor: number; // F41002.UMCONV ya dividido entre 10.000.000
}

/**
 * Unidades que hay en una caja, a partir de las conversiones del artículo en F41002 y de las unidades
 * de medida de la propia línea: la caja es la UM secundaria (SDUOM2, p. ej. BX) y las unidades, la
 * principal (SDUOM, p. ej. UN), venga como venga el código. Usa la conversión de la secundaria a la
 * principal («1 BX = f UN») o, si solo existe la contraria, 1 / f. null si falta alguna UM, son la
 * misma o el artículo no tiene ninguna de las dos conversiones.
 */
export function udsPorCaja(conversiones: ConversionUm[], umCaja: string, umUnidad: string): number | null {
  if (!umCaja || !umUnidad || umCaja === umUnidad) return null;
  const directa = conversiones.find((c) => c.de === umCaja && c.a === umUnidad && c.factor > 0);
  if (directa) return directa.factor;
  const inversa = conversiones.find((c) => c.de === umUnidad && c.a === umCaja && c.factor > 0);
  return inversa ? 1 / inversa.factor : null;
}

/**
 * Respaldo para los artículos sin conversión en F41002: uds por caja de cada artículo sacadas de sus
 * líneas que sí traen cantidad secundaria (suma de SDUORG ÷ suma de SDSQOR). Se aplica a todas sus
 * líneas, también a las que vienen sin ella (p. ej. las canceladas, que JDE deja sin cajas).
 */
export function udsPorCajaDeLineas(lineas: { articulo: string; udsPedidas: number; cajasSecundarias: number }[]): Map<string, number> {
  const sumas = new Map<string, { uds: number; cajas: number }>();
  for (const l of lineas) {
    if (!(l.udsPedidas > 0) || !(l.cajasSecundarias > 0)) continue;
    const s = sumas.get(l.articulo) ?? { uds: 0, cajas: 0 };
    s.uds += l.udsPedidas;
    s.cajas += l.cajasSecundarias;
    sumas.set(l.articulo, s);
  }
  return new Map([...sumas].map(([a, s]) => [a, s.uds / s.cajas]));
}

/** Estado de JDE (SDLTTR) de una línea cancelada. */
export const ESTADO_CANCELADA = '980';

/**
 * ¿Es la línea un resto intermedio del reparto por palet y no parte del pedido? Al enviar una línea palet
 * a palet (SSCC), JDE pasa a 980 la línea con lo que quedaba y crea otra con el nuevo resto (p. ej. 300 →
 * 200 → 100 con palets de 100), sin poner nada en SDSOCN. Sumarlas inflaba las unidades pedidas (pedidos completos salían
 * incompletos). Una cancelación de verdad también va a 980, pero con las unidades en SDSOCN: esa sí cuenta.
 * Ver docs/servicio.md §21.
 */
export const esRestoDeReparto = (l: { estado: string; udsCanceladas: number }): boolean =>
  l.estado === ESTADO_CANCELADA && !(l.udsCanceladas > 0);

/** Pedido con algo enviado (posible gemelo de un duplicado), leído fuera del rango cargado. */
export interface PedidoEnviado { pedido: number; cliente: number; suPedido: string }

const claveGemelo = (cliente: number, suPedido: string) => `${cliente}|${suPedido}`;

/**
 * Pedidos cancelados enteros: todas sus líneas con unidades canceladas (SDSOCN) y nada enviado. Solo
 * los que tienen referencia del cliente (SDVR01), que es lo que permite buscarles un gemelo.
 */
export function pedidosCanceladosEnteros(lineas: Pick<LineaJde, 'pedido' | 'cliente' | 'suPedido' | 'udsCanceladas' | 'udsEnviadas'>[]): Map<number, { cliente: number; suPedido: string }> {
  const r = new Map<number, { cliente: number; suPedido: string; cancelado: boolean }>();
  for (const l of lineas) {
    const p = r.get(l.pedido) ?? { cliente: l.cliente, suPedido: l.suPedido.trim(), cancelado: true };
    if (!(l.udsCanceladas > 0) || l.udsEnviadas > 0) p.cancelado = false;
    r.set(l.pedido, p);
  }
  return new Map([...r].filter(([, p]) => p.cancelado && p.suPedido).map(([k, p]) => [k, { cliente: p.cliente, suPedido: p.suPedido }]));
}

/**
 * Pedidos duplicados → pedido gemelo. A veces un pedido entra dos veces en JDE: uno se sirve y el otro
 * se cancela entero, y los dos llevan la misma referencia del cliente (SDVR01). El cancelado no es un
 * incumplimiento, así que se marca y no cuenta en los KPI (sí sale en la tabla, etiquetado). Gemelo =
 * otro pedido del mismo cliente (SDAN8) y misma SDVR01 con algo enviado, del rango cargado o de
 * `enviadosFuera` (consulta aparte sin filtro de fecha). Ver docs/servicio.md §22.
 */
export function detectarDuplicados(lineas: LineaJde[], enviadosFuera: PedidoEnviado[] = []): Map<number, number> {
  const cancelados = pedidosCanceladosEnteros(lineas);
  if (cancelados.size === 0) return new Map();
  const enviados = new Map<string, number>();
  const anotar = (p: PedidoEnviado) => {
    const k = claveGemelo(p.cliente, p.suPedido.trim());
    if (p.suPedido.trim() && !enviados.has(k)) enviados.set(k, p.pedido);
  };
  for (const l of lineas) if (l.udsEnviadas > 0) anotar(l);
  for (const p of enviadosFuera) anotar(p);
  const r = new Map<number, number>();
  for (const [pedido, c] of cancelados) {
    const gemelo = enviados.get(claveGemelo(c.cliente, c.suPedido));
    if (gemelo !== undefined && gemelo !== pedido) r.set(pedido, gemelo);
  }
  return r;
}

/**
 * Cantidades de una línea de F4211 ya en unidades (SDUORG / SDSOQS ÷ 100). Solo cuenta como enviado
 * lo que tiene fecha de envío real (SDADDJ, salida de stock 570→580): JDE rellena SDSOQS antes, en el
 * picking (550), y una línea así aún no ha salido. Cajas = unidades ÷ uds por caja (0 si no se sabe).
 */
export function cantidadesLinea(l: { udsPedidas: number; udsServidas: number; fechaEnvio: string | null; udsPorCaja: number | null }) {
  const udsEnviadas = l.fechaEnvio ? l.udsServidas : 0;
  const f = l.udsPorCaja && l.udsPorCaja > 0 ? l.udsPorCaja : null;
  return { udsEnviadas, cajasPedidas: f ? l.udsPedidas / f : 0, cajasEnviadas: f ? udsEnviadas / f : 0 };
}

// Tipos de pedido de JDE (SDDCTO) que cuentan para el nivel de servicio, con su nombre en pantalla.
// Fuera: ST/OT (envíos entre almacenes), S1/SH (cargos), CO/C1 (devoluciones y abonos). Solo se leen
// las líneas de stock (SDLNTY = 'S'): las N (portes, cargos) no llevan albarán ni se envían.
export const TIPOS_PEDIDO = { SO: 'Venta', SE: 'EDI / Mercadona', SM: 'Muestra nacional', SY: 'Muestra exportación' } as const;
export type TipoPedido = keyof typeof TIPOS_PEDIDO;
export const TIPO_LINEA_STOCK = 'S';

/** Objetivo de servicio (%): el de Makro. Por encima, verde; por debajo, ámbar y, muy por debajo, rojo. */
export const OBJETIVO_OTIF_PCT = 98;

export type EstadoEntrega = 'pendiente_envio' | 'a_tiempo' | 'tarde';

// Una línea de F4211 ya normalizada (fechas ISO o null, cantidades ya divididas entre 100).
export interface LineaJde {
  pedido: number;
  tipoPedido: string; // SDDCTO (TIPOS_PEDIDO)
  suPedido: string;
  albaran: number; // SDDELN — 0 si aún no hay albarán (sin enviar)
  cliente: number;
  clienteNombre: string;
  destino: number;
  destinoNombre: string;
  fechaEnvio: string | null; // SDADDJ — fecha real de envío
  fechaPrometida: string | null; // SDRSDJ
  udsPedidas: number; // SDUORG, en la UM principal de la línea (SDUOM)
  udsEnviadas: number; // SDSOQS, solo si la línea tiene fecha de envío (cantidadesLinea)
  cajasPedidas: number; // udsPedidas ÷ udsPorCaja
  cajasEnviadas: number; // udsEnviadas ÷ udsPorCaja
  udsCanceladas: number; // SDSOCN — informativo: no genera incidencia sola (ver docs/servicio.md §8)
  canal: string | null; // código F554101.AAZE06 del artículo
  articulo: string; // SDLITM (2º nº de artículo)
  descripcion: string; // SDDSC1
  udsPorCaja: number | null; // F41002 de SDUOM2 a SDUOM o, si no, udsPorCajaDeLineas; null = sin cajas
}

// Un artículo de un envío (suma de sus líneas), para anotar las afectadas por artículo
export interface ArticuloEnvio {
  articulo: string;
  descripcion: string;
  udsPedidas: number;
  udsEnviadas: number;
  udsPorCaja: number | null;
}

// Afectadas anotadas a mano de un artículo (tabla order_service_incidencia_articulo)
export interface AfectadaArticulo {
  articulo: string;
  uds: number;
  cajas: number; // uds ÷ uds por caja de ese artículo, con decimales; 0 si el artículo no tiene cajas
}

// Una entrega de un pedido: todas las líneas de F4211 con el mismo (pedido, albarán). Las líneas
// sin albarán (0) solo son un envío propio («Sin enviar») si el pedido no tiene ningún albarán;
// si lo tiene, se suman a su último envío (ver agruparEnvios).
export interface Envio {
  pedido: number;
  tipoPedido: string;
  suPedido: string;
  albaran: number;
  cliente: number;
  clienteNombre: string;
  destino: number;
  destinoNombre: string;
  canal: string | null;
  fechaEnvio: string | null;
  fechaPrometida: string | null;
  udsPedidas: number;
  udsEnviadas: number;
  cajasPedidas: number;
  cajasEnviadas: number;
  udsCanceladas: number;
  articulos: ArticuloEnvio[];
  duplicadoDe: number | null; // pedido gemelo si este es un duplicado cancelado (detectarDuplicados): no cuenta en los KPI
}

// Suma una línea (o un artículo de otro envío) a la lista de artículos de un envío
function sumarArticulo(lista: ArticuloEnvio[], a: ArticuloEnvio) {
  const x = lista.find((y) => y.articulo === a.articulo);
  if (!x) { lista.push({ ...a }); return; }
  x.udsPedidas += a.udsPedidas;
  x.udsEnviadas += a.udsEnviadas;
  if (x.udsPorCaja === null) x.udsPorCaja = a.udsPorCaja;
  if (!x.descripcion) x.descripcion = a.descripcion;
}
const articuloDe = (l: LineaJde): ArticuloEnvio => ({ articulo: l.articulo, descripcion: l.descripcion, udsPedidas: l.udsPedidas, udsEnviadas: l.udsEnviadas, udsPorCaja: l.udsPorCaja });

// JDE guarda fechas como CYYDDD (C=1 → 2000s, DDD = día del año). 0 = sin fecha.
export function jdeAIso(n: number | null | undefined): string | null {
  if (!n) return null;
  const año = 1900 + Math.floor(n / 1000);
  const dia = n % 1000;
  return new Date(Date.UTC(año, 0, dia)).toISOString().slice(0, 10);
}

// ISO → JDE (inverso de jdeAIso), para acotar la consulta por rango de fechas.
export function isoAJde(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const dia = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return (y - 1900) * 1000 + dia;
}

const min = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
const max = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a ?? b);

// Agrupa las líneas por (pedido, albarán). El canal es el del pedido entero: un pedido
// tiene un solo canal (confirmado), así que se toma el que más unidades pide — si JDE
// devolviera varios, gana el mayoritario en vez de partir el pedido.
export function agruparEnvios(lineas: LineaJde[], duplicados: Map<number, number> = new Map()): Envio[] {
  const canalPorPedido = new Map<number, Map<string, number>>();
  for (const l of lineas) {
    if (!l.canal) continue;
    const m = canalPorPedido.get(l.pedido) ?? new Map<string, number>();
    m.set(l.canal, (m.get(l.canal) ?? 0) + l.udsPedidas);
    canalPorPedido.set(l.pedido, m);
  }
  const canalDe = (pedido: number) => {
    const m = canalPorPedido.get(pedido);
    if (!m) return null;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const envios = new Map<string, Envio>();
  for (const l of lineas) {
    const k = `${l.pedido}|${l.albaran}`;
    const e = envios.get(k);
    if (!e) {
      envios.set(k, {
        pedido: l.pedido, tipoPedido: l.tipoPedido, suPedido: l.suPedido, albaran: l.albaran,
        cliente: l.cliente, clienteNombre: l.clienteNombre, destino: l.destino, destinoNombre: l.destinoNombre,
        canal: canalDe(l.pedido),
        fechaEnvio: l.fechaEnvio, fechaPrometida: l.fechaPrometida,
        udsPedidas: l.udsPedidas, udsEnviadas: l.udsEnviadas, cajasPedidas: l.cajasPedidas, cajasEnviadas: l.cajasEnviadas, udsCanceladas: l.udsCanceladas,
        articulos: [articuloDe(l)],
        duplicadoDe: duplicados.get(l.pedido) ?? null,
      });
      continue;
    }
    sumarArticulo(e.articulos, articuloDe(l));
    e.fechaEnvio = max(e.fechaEnvio, l.fechaEnvio);
    e.fechaPrometida = min(e.fechaPrometida, l.fechaPrometida);
    e.udsPedidas += l.udsPedidas;
    e.udsEnviadas += l.udsEnviadas;
    e.cajasPedidas += l.cajasPedidas;
    e.cajasEnviadas += l.cajasEnviadas;
    e.udsCanceladas += l.udsCanceladas;
  }

  // Líneas sin albarán (pendientes o canceladas, p. ej. el resto de una línea partida en JDE) de un
  // pedido que ya tiene algún albarán: no salen como fila «Sin enviar» aparte (repetía el total del
  // pedido), sino que se suman a su último envío. Así cuentan en el total del pedido (la barra no se
  // completa y el pedido no es completo) y quien lo vea decide si anota una incidencia. Solo se suman
  // cantidades: las fechas son las del envío real.
  const lista = [...envios.values()];
  const ultimoEnvio = new Map<number, Envio>();
  for (const e of lista) {
    if (e.albaran === 0) continue;
    const u = ultimoEnvio.get(e.pedido);
    const fe = e.fechaEnvio ?? '';
    const fu = u?.fechaEnvio ?? '';
    if (!u || fe > fu || (fe === fu && e.albaran > u.albaran)) ultimoEnvio.set(e.pedido, e);
  }
  return lista.filter((e) => {
    const destino = e.albaran === 0 ? ultimoEnvio.get(e.pedido) : undefined;
    if (!destino) return true;
    destino.udsPedidas += e.udsPedidas;
    destino.udsEnviadas += e.udsEnviadas;
    destino.cajasPedidas += e.cajasPedidas;
    destino.cajasEnviadas += e.cajasEnviadas;
    destino.udsCanceladas += e.udsCanceladas;
    for (const a of e.articulos) sumarArticulo(destino.articulos, a);
    return false;
  });
}

// A tiempo = entrega real ≤ fecha prometida de JDE. Un envío ya enviado sin fecha real anotada se
// da por entregado en la fecha prometida (a tiempo), como en el Excel original; si después se anota
// otra fecha, cuenta esa. Lo no enviado queda «pendiente de envío».
export function estadoEntrega(e: { fechaEnvio: string | null; fechaPrometida: string | null }, entregaReal: string | null): EstadoEntrega {
  if (!e.fechaEnvio) return 'pendiente_envio';
  if (!entregaReal || !e.fechaPrometida) return 'a_tiempo';
  return entregaReal <= e.fechaPrometida ? 'a_tiempo' : 'tarde';
}

// ¿Envío enviado al que nadie ha anotado la fecha de entrega real? Cuenta como a tiempo (fecha
// prometida), pero se cuenta aparte para que se vea cuántos estados son supuestos.
export const sinFechaReal = (e: { fechaEnvio: string | null; fechaEntregaReal?: string | null }): boolean =>
  !!e.fechaEnvio && e.fechaEntregaReal === null;

export interface PedidoResumen {
  pedido: number;
  udsPedidas: number;
  udsEnviadas: number;
  cajasPedidas: number;
  cajasEnviadas: number;
  cajasAfectadas: number; // uds afectadas pasadas a cajas con la proporción de su envío
  udsAfectadas: number; // incidencias anotadas a mano (suma de sus envíos)
  completo: boolean;
  fechaPrometida: string | null;
  entrega: EstadoEntrega;
  sinFechaReal: boolean; // algún envío enviado sin fecha de entrega real anotada (su «a tiempo» es supuesto)
  duplicadoDe: number | null; // duplicado cancelado de otro pedido: no cuenta en los KPI
}

// Resumen por pedido a partir de sus envíos (con el estado de entrega ya calculado).
// Completo = se ha enviado todo lo pedido. Entrega del pedido: cualquier envío tarde →
// tarde; si no, alguno a tiempo → a tiempo; si no (nada enviado) → pendiente de envío.
export function resumirPedidos(envios: { pedido: number; udsPedidas: number; udsEnviadas: number; cajasPedidas?: number; cajasEnviadas?: number; udsAfectadas?: number; cajasAfectadas?: number; fechaPrometida: string | null; entrega: EstadoEntrega; fechaEnvio?: string | null; fechaEntregaReal?: string | null; duplicadoDe?: number | null }[]): PedidoResumen[] {
  const pedidos = new Map<number, PedidoResumen>();
  for (const e of envios) {
    const p = pedidos.get(e.pedido) ?? { pedido: e.pedido, udsPedidas: 0, udsEnviadas: 0, cajasPedidas: 0, cajasEnviadas: 0, cajasAfectadas: 0, udsAfectadas: 0, completo: false, fechaPrometida: null, entrega: 'pendiente_envio' as EstadoEntrega, sinFechaReal: false, duplicadoDe: e.duplicadoDe ?? null };
    if (sinFechaReal({ fechaEnvio: e.fechaEnvio ?? null, fechaEntregaReal: e.fechaEntregaReal })) p.sinFechaReal = true;
    p.udsPedidas += e.udsPedidas;
    p.udsEnviadas += e.udsEnviadas;
    p.cajasPedidas += e.cajasPedidas ?? 0;
    p.cajasEnviadas += e.cajasEnviadas ?? 0;
    p.udsAfectadas += e.udsAfectadas ?? 0;
    // Cajas afectadas: las anotadas a mano si las hay; si no, las unidades afectadas pasadas a cajas con la proporción del envío
    if ((e.cajasAfectadas ?? 0) > 0) p.cajasAfectadas += e.cajasAfectadas ?? 0;
    else if (e.udsPedidas > 0) p.cajasAfectadas += (e.udsAfectadas ?? 0) * ((e.cajasPedidas ?? 0) / e.udsPedidas);
    p.fechaPrometida = min(p.fechaPrometida, e.fechaPrometida);
    if (e.entrega === 'tarde' || p.entrega === 'tarde') p.entrega = 'tarde';
    else if (e.entrega === 'a_tiempo') p.entrega = 'a_tiempo';
    pedidos.set(e.pedido, p);
  }
  for (const p of pedidos.values()) p.completo = p.udsEnviadas >= p.udsPedidas;
  return [...pedidos.values()];
}

export interface Kpis {
  pedidos: number; // evaluados (los abiertos y los duplicados no cuentan)
  abiertos: number; // incompletos con fecha prometida aún no vencida
  duplicados: number; // duplicados cancelados de otro pedido, fuera de todos los KPI
  aTiempo: number; // evaluados a tiempo
  sinFechaReal: number; // evaluados con algún envío sin fecha real anotada (a tiempo supuesto)
  pctATiempo: number | null;
  pctCompleto: number | null;
  pctOtif: number | null;
  udsPedidas: number;
  udsEnviadas: number;
  udsIncidencia: number; // solo las afectadas anotadas a mano (lo no enviado no cuenta aquí)
  pctOtifUds: number | null; // 1 − uds con incidencia / uds pedidas
  cajasIncidencia: number; // solo las afectadas anotadas a mano, en cajas
  pctOtifCajas: number | null; // 1 − cajas con incidencia / cajas pedidas (Carrefour mide por cajas)
  pctConFechaReal: number | null; // % de pedidos evaluados con todas sus fechas de entrega reales anotadas
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

// Un pedido "abierto" (incompleto y con la fecha prometida aún por llegar) todavía puede
// cumplirse, así que no se evalúa. A tiempo, completo y OTIF se miden sobre todos los evaluados:
// un pedido vencido sin nada enviado no está a tiempo.
// Uds/cajas con incidencia = SOLO lo anotado a mano (decisión del negocio, nov. 2026): al anotar una
// incidencia ponen como afectadas las unidades que faltan, así que sumar además lo no enviado las
// contaba dos veces. Lo no enviado sigue haciendo el pedido incompleto (% Completo, OTIF por pedido).
// Los duplicados cancelados de otro pedido (detectarDuplicados) no cuentan en nada.
export function calcularKpis(todos: PedidoResumen[], hoy: string): Kpis {
  const pedidos = todos.filter((p) => !p.duplicadoDe);
  const abierto = (p: PedidoResumen) => !p.completo && (!p.fechaPrometida || p.fechaPrometida >= hoy);
  const evaluados = pedidos.filter((p) => !abierto(p));
  const aTiempo = evaluados.filter((p) => p.entrega === 'a_tiempo');
  const sinFecha = evaluados.filter((p) => p.sinFechaReal).length;
  const udsPedidas = evaluados.reduce((s, p) => s + p.udsPedidas, 0);
  const udsIncidencia = evaluados.reduce((s, p) => s + p.udsAfectadas, 0);
  const cajasPedidas = evaluados.reduce((s, p) => s + p.cajasPedidas, 0);
  const cajasIncidencia = evaluados.reduce((s, p) => s + p.cajasAfectadas, 0);
  return {
    pedidos: evaluados.length,
    abiertos: pedidos.length - evaluados.length,
    duplicados: todos.length - pedidos.length,
    aTiempo: aTiempo.length,
    sinFechaReal: sinFecha,
    pctATiempo: pct(aTiempo.length, evaluados.length),
    pctCompleto: pct(evaluados.filter((p) => p.completo).length, evaluados.length),
    pctOtif: pct(aTiempo.filter((p) => p.completo).length, evaluados.length),
    udsPedidas,
    udsEnviadas: evaluados.reduce((s, p) => s + p.udsEnviadas, 0),
    udsIncidencia,
    pctOtifUds: udsPedidas > 0 ? 100 - (udsIncidencia / udsPedidas) * 100 : null,
    cajasIncidencia,
    pctOtifCajas: cajasPedidas > 0 ? 100 - (cajasIncidencia / cajasPedidas) * 100 : null,
    pctConFechaReal: pct(evaluados.length - sinFecha, evaluados.length),
  };
}

// --- Indicadores (pestaña «Indicadores»): agregados por mes y canal ---------------------

type EnvioIndicadores = {
  pedido: number; canal: string | null; udsPedidas: number; udsEnviadas: number; udsAfectadas: number;
  fechaPrometida: string | null; entrega: EstadoEntrega; motivo: string; responsable: string;
  fechaEnvio?: string | null; fechaEntregaReal?: string | null; duplicadoDe?: number | null;
};

export interface FilaMes { mes: string; canal: string | null; kpis: Kpis }

// Una fila por (mes de la fecha prometida del pedido, canal), con los KPIs de ese grupo.
// Ordenadas por mes y canal. El mes de un pedido es el de su fecha prometida más temprana.
export function resumenMensual(envios: EnvioIndicadores[], hoy: string): FilaMes[] {
  const prometida = new Map(resumirPedidos(envios).map((p) => [p.pedido, p.fechaPrometida]));
  const grupos = new Map<string, { mes: string; canal: string | null; envios: EnvioIndicadores[] }>();
  for (const e of envios) {
    const mes = prometida.get(e.pedido)?.slice(0, 7);
    if (!mes) continue;
    const k = `${mes}|${e.canal ?? ''}`;
    const g = grupos.get(k) ?? { mes, canal: e.canal, envios: [] };
    g.envios.push(e);
    grupos.set(k, g);
  }
  return [...grupos.values()]
    .sort((a, b) => a.mes.localeCompare(b.mes) || (a.canal ?? '').localeCompare(b.canal ?? ''))
    .map((g) => ({ mes: g.mes, canal: g.canal, kpis: calcularKpis(resumirPedidos(g.envios), hoy) }));
}

// Incidencias = envíos con motivo anotado (sin los duplicados). Cuenta por motivo o por responsable.
export function contarIncidencias(envios: EnvioIndicadores[], por: 'motivo' | 'responsable'): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of envios) {
    if (!e.motivo || e.duplicadoDe) continue;
    const clave = (por === 'motivo' ? e.motivo : e.responsable) || 'Sin indicar';
    r[clave] = (r[clave] ?? 0) + 1;
  }
  return r;
}

// Incidencias por mes (de la fecha prometida del envío) y motivo, para barras apiladas.
export function incidenciasPorMes(envios: EnvioIndicadores[]): { mes: string; [motivo: string]: string | number }[] {
  const meses = new Map<string, Record<string, number>>();
  for (const e of envios) {
    const mes = e.fechaPrometida?.slice(0, 7);
    const motivo = e.motivo;
    if (!mes || !motivo || e.duplicadoDe) continue;
    const m = meses.get(mes) ?? {};
    m[motivo] = (m[motivo] ?? 0) + 1;
    meses.set(mes, m);
  }
  return [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, m]) => ({ mes, ...m }));
}

// Datos manuales de un envío tal como se guardan en SQLite (order_service_tracking).
// `articulos`: desglose de las afectadas por artículo (order_service_incidencia_articulo). Si lo hay,
// uds_afectadas y cajas_afectadas son su suma; si no, son lo anotado antes «sin desglose».
export interface TrackingManual {
  transportista: string; fecha_entrega_real: string | null; responsable: string; motivo: string; incidencia: string; uds_afectadas: number; cajas_afectadas?: number;
  articulos?: AfectadaArticulo[];
}

const MAX_ARTICULOS = 200;
const CODIGO_ARTICULO = /^[\w.-]{1,25}$/;

// Valida el desglose de afectadas por artículo que llega en el PATCH. Quita las filas a cero y
// redondea las cajas a 2 decimales. null si algo no es válido (la API responde 400).
export function validarAfectadasArticulos(v: unknown): AfectadaArticulo[] | null {
  if (!Array.isArray(v) || v.length > MAX_ARTICULOS) return null;
  const vistos = new Set<string>();
  const r: AfectadaArticulo[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') return null;
    const { articulo, uds, cajas } = x as Record<string, unknown>;
    if (typeof articulo !== 'string' || !CODIGO_ARTICULO.test(articulo) || vistos.has(articulo)) return null;
    const u = Number(uds);
    const c = Number(cajas ?? 0);
    if (!Number.isInteger(u) || u < 0 || u > 10_000_000 || !Number.isFinite(c) || c < 0 || c > 10_000_000) return null;
    vistos.add(articulo);
    if (u > 0 || c > 0) r.push({ articulo, uds: u, cajas: Math.round(c * 100) / 100 });
  }
  return r;
}

// Total de un desglose: es lo que se guarda en uds_afectadas / cajas_afectadas (KPIs y gráficos)
export const totalAfectadas = (lista: AfectadaArticulo[]) => ({
  uds: lista.reduce((s, a) => s + a.uds, 0),
  cajas: Math.round(lista.reduce((s, a) => s + a.cajas, 0) * 100) / 100,
});

// Cruza las líneas de JDE con los datos manuales y calcula todo lo que devuelve la API:
// envíos con estado de entrega, unidades del pedido completo y KPIs. Es la misma ruta
// para datos reales y de ejemplo (?mock=1), así que no hay lógica duplicada. `enviadosFuera`: posibles
// gemelos de los cancelados enteros con fecha fuera del rango (ver detectarDuplicados).
export function armarRespuesta(lineas: LineaJde[], tracking: Map<string, TrackingManual>, canalLabels: Record<string, string>, hoy: string, enviadosFuera: PedidoEnviado[] = []) {
  const envios = agruparEnvios(lineas, detectarDuplicados(lineas, enviadosFuera)).map((e) => {
    const t = tracking.get(`${e.pedido}|${e.albaran}`);
    const entregaReal = t?.fecha_entrega_real ?? null;
    return {
      ...e,
      canalLabel: e.canal ? canalLabels[e.canal] ?? e.canal : null,
      transportista: t?.transportista ?? '',
      fechaEntregaReal: entregaReal,
      responsable: t?.responsable ?? '',
      motivo: t?.motivo ?? '',
      incidencia: t?.incidencia ?? '',
      udsAfectadas: t?.uds_afectadas ?? 0,
      cajasAfectadas: t?.cajas_afectadas ?? 0,
      afectadasArticulos: t?.articulos ?? [],
      entrega: estadoEntrega(e, entregaReal),
    };
  });
  envios.sort((a, b) => (b.fechaPrometida ?? '').localeCompare(a.fechaPrometida ?? '') || b.pedido - a.pedido || a.albaran - b.albaran);

  const pedidos = resumirPedidos(envios);
  const porPedido = new Map(pedidos.map((p) => [p.pedido, p]));
  const enviosDto = envios.map((e) => {
    const p = porPedido.get(e.pedido)!;
    return { ...e, pedidoUdsPedidas: p.udsPedidas, pedidoUdsEnviadas: p.udsEnviadas, pedidoCajasPedidas: p.cajasPedidas, pedidoCajasEnviadas: p.cajasEnviadas, pedidoCompleto: p.completo };
  });
  return { envios: enviosDto, kpis: calcularKpis(pedidos, hoy) };
}

// --- Datos de ejemplo (/servicio?mock=1) ------------------------------------------------
// Entregas FICTICIAS de enero a julio de 2024 para ver los gráficos sin Oracle ni tocar la
// tabla real order_service_tracking. Determinista (mismo resultado siempre). Ningún dato
// real: clientes inventados. Calidad distinta por mes y canal para que las líneas y las
// barras tengan forma.
export const EJEMPLO_CANALES: Record<string, string> = { HOR: 'Horeca', RET: 'Retail', EXP: 'Exportación' };

const MOTIVO_RESP: Record<string, { resp: string; texto: string }> = {
  'Preparación': { resp: 'Elaborados', texto: 'Falta producto en la preparación' },
  'Producción': { resp: 'Elaborados', texto: 'Sin stock por no poder fabricar' },
  'Cajas rotas': { resp: 'Transportista', texto: 'Cajas rotas en el transporte' },
  'Transporte': { resp: 'Transportista', texto: 'Entrega fuera de plazo' },
  'Expediciones': { resp: 'Elaborados', texto: 'Pedido sin cargar por error' },
  'Comercial': { resp: 'Otros', texto: 'Cambio de pedido de última hora' },
  'Cliente': { resp: 'Cliente', texto: 'Cliente rechaza la mercancía' },
  'Otros': { resp: 'Otros', texto: 'Otra incidencia' },
};
// Repetidos a propósito: Preparación y Producción son los motivos más frecuentes.
const MOTIVOS_PESO = ['Preparación', 'Preparación', 'Preparación', 'Producción', 'Producción', 'Cajas rotas', 'Transporte', 'Expediciones', 'Comercial', 'Otros', 'Cliente'];
const TRANSPORTISTAS = ['Transportes Norte', 'Frío Ibérica', 'Logística Sur', 'Camiones del Ebro'];
// Repetidos a propósito: casi todo es venta (SO/SE), alguna muestra
const TIPOS_EJEMPLO: TipoPedido[] = ['SO', 'SO', 'SO', 'SO', 'SE', 'SE', 'SE', 'SM', 'SO', 'SY'];
// Artículos inventados (códigos 9000…, que no existen en JDE)
type ArticuloEjemplo = { articulo: string; descripcion: string; udsPorCaja: number };
const ARTICULOS_EJEMPLO: ArticuloEjemplo[] = [
  { articulo: '9000000001', descripcion: 'Tortilla ejemplo 600 g', udsPorCaja: 12 },
  { articulo: '9000000002', descripcion: 'Tortilla ejemplo con cebolla 1 kg', udsPorCaja: 6 },
  { articulo: '9000000003', descripcion: 'Migas ejemplo 400 g', udsPorCaja: 12 },
];

export function generarEjemplo(): { lineas: LineaJde[]; tracking: Map<string, TrackingManual> } {
  let semilla = 12345; // LCG determinista
  const rnd = () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const suma = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86400000).toISOString().slice(0, 10);
  const lineas: LineaJde[] = [];
  const tracking = new Map<string, TrackingManual>();
  // [canal, pedidos por mes, probabilidad de problema de enero a julio]
  const canales: [string, number, number[]][] = [
    ['HOR', 36, [0.10, 0.08, 0.09, 0.07, 0.12, 0.06, 0.05]],
    ['RET', 14, [0.05, 0.04, 0.06, 0.05, 0.04, 0.16, 0.05]],
    ['EXP', 9, [0.04, 0.06, 0.20, 0.08, 0.05, 0.04, 0.06]],
  ];
  let pedido = 900000;
  for (let m = 0; m < 7; m++) {
    for (const [canal, n, probProblema] of canales) {
      for (let i = 0; i < n; i++) {
        pedido++;
        const dia = 1 + Math.floor(rnd() * 27);
        const prometida = `2024-${String(m + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const problema = rnd() < probProblema[m];
        const pedidas = 100 + Math.floor(rnd() * 25) * 24;
        const incompleto = problema && rnd() < 0.6;
        const enviadasTotal = incompleto ? Math.floor(pedidas * (0.8 + rnd() * 0.15)) : pedidas;
        const albaranes = rnd() < 0.2 ? 2 : 1;
        for (let c = 0; c < albaranes; c++) {
          const albaran = 700000 + pedido * 2 + c;
          const parte = albaranes === 1 ? 1 : c === 0 ? 0.6 : 0.4;
          const llegaTarde = problema && rnd() < 0.5;
          const sinFecha = !problema && rnd() < 0.05; // sin fecha real anotada: cuenta la prometida
          const real = sinFecha ? null : suma(prometida, llegaTarde ? 1 + Math.floor(rnd() * 3) : -Math.floor(rnd() * 2));
          const motivo = problema ? (llegaTarde && rnd() < 0.5 ? 'Transporte' : MOTIVOS_PESO[Math.floor(rnd() * MOTIVOS_PESO.length)]) : '';
          // Los pedidos pares llevan dos artículos (de 12 y de 6 uds/caja) para ver el desglose por artículo
          const uP = Math.round(pedidas * parte);
          const uE = Math.round(enviadasTotal * parte);
          const reparto: [ArticuloEjemplo, number][] = pedido % 2 === 0
            ? [[ARTICULOS_EJEMPLO[0], 0.5], [ARTICULOS_EJEMPLO[1], 0.5]]
            : [[ARTICULOS_EJEMPLO[pedido % ARTICULOS_EJEMPLO.length], 1]];
          let restoP = uP, restoE = uE;
          reparto.forEach(([art, frac], j) => {
            const ultimo = j === reparto.length - 1;
            const p = ultimo ? restoP : Math.round(uP * frac);
            const e = ultimo ? restoE : Math.round(uE * frac);
            restoP -= p; restoE -= e;
            lineas.push({
              pedido, tipoPedido: TIPOS_EJEMPLO[pedido % TIPOS_EJEMPLO.length], suPedido: `EJ-${pedido}`, albaran, cliente: 100 + (pedido % 40),
              clienteNombre: `Cliente ejemplo ${canal} ${pedido % 40}`, destino: 100 + (pedido % 40), destinoNombre: `Cliente ejemplo ${canal} ${pedido % 40}`,
              fechaEnvio: suma(prometida, -1), fechaPrometida: prometida,
              udsPedidas: p, udsEnviadas: e, canal,
              udsCanceladas: incompleto && c === 0 && j === 0 && pedido % 3 === 0 ? Math.max(0, Math.round((pedidas - enviadasTotal) * parte)) : 0,
              cajasPedidas: p / art.udsPorCaja, cajasEnviadas: e / art.udsPorCaja,
              articulo: art.articulo, descripcion: art.descripcion, udsPorCaja: art.udsPorCaja,
            });
          });
          // Afectadas: todas en el primer artículo del envío
          const u = motivo ? 6 + Math.floor(rnd() * 90) : 0;
          const art = reparto[0][0];
          const articulos: AfectadaArticulo[] = u > 0 ? [{ articulo: art.articulo, uds: u, cajas: Math.round((u / art.udsPorCaja) * 100) / 100 }] : [];
          const total = totalAfectadas(articulos);
          tracking.set(`${pedido}|${albaran}`, {
            transportista: TRANSPORTISTAS[pedido % TRANSPORTISTAS.length], fecha_entrega_real: real,
            responsable: motivo ? MOTIVO_RESP[motivo].resp : '', motivo, incidencia: motivo ? MOTIVO_RESP[motivo].texto : '',
            uds_afectadas: total.uds, cajas_afectadas: total.cajas, articulos,
          });
        }
      }
    }
  }
  // Un pedido que entró dos veces: copia del primero, cancelada entera y con su misma referencia del
  // cliente, para ver la etiqueta «Duplicado» (no cuenta en los KPI)
  const original = lineas.find((l) => l.pedido === 900001)!;
  lineas.push({ ...original, pedido: 999001, albaran: 0, fechaEnvio: null, udsEnviadas: 0, cajasEnviadas: 0, udsCanceladas: original.udsPedidas });
  return { lineas, tracking };
}

// Un envío «tiene incidencia» solo si se le ha anotado algo (motivo, texto o unidades afectadas). Las
// unidades canceladas (SDSOCN) ya no generan una incidencia sola: cuentan como no enviadas (el pedido no
// es completo) y quien lo revise anota el motivo si lo ve conveniente.
type ConIncidencia = { motivo: string; incidencia: string; udsAfectadas: number; cajasAfectadas?: number };
export function tieneIncidencia(e: ConIncidencia): boolean {
  return !!e.motivo || !!e.incidencia || e.udsAfectadas > 0 || (e.cajasAfectadas ?? 0) > 0;
}

// Filtro de clientes de /servicio: lista vacía = todos. Con `excluir`, la lista son los clientes QUITADOS
// («todos menos estos»: un cliente nuevo entra solo). Se aplica sobre los envíos ya cargados, así que no
// toca Oracle y KPIs, tabla e indicadores se calculan con lo que queda. `cliente` es SDAN8 (no el destino).
export function filtrarPorClientes<T extends { cliente: number }>(envios: T[], clientes: number[], excluir = false): T[] {
  if (clientes.length === 0) return envios;
  const lista = new Set(clientes);
  return envios.filter((e) => lista.has(e.cliente) !== excluir);
}

// Filtro de tipos de pedido (SDDCTO): mismas reglas que el de clientes (vacío = todos; `excluir` = todos menos).
export function filtrarPorTipos<T extends { tipoPedido: string }>(envios: T[], tipos: string[], excluir = false): T[] {
  if (tipos.length === 0) return envios;
  const lista = new Set(tipos);
  return envios.filter((e) => lista.has(e.tipoPedido) !== excluir);
}
