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

// Códigos de unidad de medida de JDE (F41002.UMUM / UMRUM) para cajas y unidades. Son los que usa
// docs/produccion.md en su ejemplo de conversiones (CJ→UN); si en JDE se llaman distinto, se
// cambian aquí y en nada más.
export const UM_CAJA = 'CJ';
export const UM_UNIDAD = 'UN';

export interface ConversionUm {
  de: string; // F41002.UMUM
  a: string; // F41002.UMRUM
  factor: number; // F41002.UMCONV ya dividido entre 10.000.000
}

/**
 * Unidades que hay en una caja de un artículo, a partir de sus conversiones de F41002: la que
 * va de CJ a UN («1 CJ = f UN») o, si solo existe la contraria, 1 / f. null si el artículo no tiene
 * ninguna de las dos (entonces se usan las cajas de SDSQOR).
 */
export function udsPorCaja(conversiones: ConversionUm[]): number | null {
  const directa = conversiones.find((c) => c.de === UM_CAJA && c.a === UM_UNIDAD && c.factor > 0);
  if (directa) return directa.factor;
  const inversa = conversiones.find((c) => c.de === UM_UNIDAD && c.a === UM_CAJA && c.factor > 0);
  return inversa ? 1 / inversa.factor : null;
}

/** Objetivo de servicio (%): el de Makro. Por encima, verde; por debajo, ámbar y, muy por debajo, rojo. */
export const OBJETIVO_OTIF_PCT = 98;

export type EstadoEntrega = 'pendiente_envio' | 'sin_confirmar' | 'a_tiempo' | 'tarde';

// Una línea de F4211 ya normalizada (fechas ISO o null, cantidades ya divididas entre 100).
export interface LineaJde {
  pedido: number;
  suPedido: string;
  albaran: number; // SDDELN — 0 si aún no hay albarán (sin enviar)
  cliente: number;
  clienteNombre: string;
  destino: number;
  destinoNombre: string;
  fechaEnvio: string | null; // SDADDJ — fecha real de envío
  fechaPrometida: string | null; // SDRSDJ
  udsPedidas: number; // SDUORG
  udsEnviadas: number; // SDSOQS
  cajasPedidas: number; // SDSQOR (cantidad pedida secundaria = cajas)
  cajasEnviadas: number; // proporcional por línea: SDSQOR × SDSOQS / SDUORG
  udsCanceladas: number; // SDSOCN
  canal: string | null; // código F554101.AAZE06 del artículo
}

// Una entrega de un pedido: todas las líneas de F4211 con el mismo (pedido, albarán). El
// albarán 0 agrupa lo que aún no se ha enviado.
export interface Envio {
  pedido: number;
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
}

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
export function agruparEnvios(lineas: LineaJde[]): Envio[] {
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
        pedido: l.pedido, suPedido: l.suPedido, albaran: l.albaran,
        cliente: l.cliente, clienteNombre: l.clienteNombre, destino: l.destino, destinoNombre: l.destinoNombre,
        canal: canalDe(l.pedido),
        fechaEnvio: l.fechaEnvio, fechaPrometida: l.fechaPrometida,
        udsPedidas: l.udsPedidas, udsEnviadas: l.udsEnviadas, cajasPedidas: l.cajasPedidas, cajasEnviadas: l.cajasEnviadas, udsCanceladas: l.udsCanceladas,
      });
      continue;
    }
    e.fechaEnvio = max(e.fechaEnvio, l.fechaEnvio);
    e.fechaPrometida = min(e.fechaPrometida, l.fechaPrometida);
    e.udsPedidas += l.udsPedidas;
    e.udsEnviadas += l.udsEnviadas;
    e.cajasPedidas += l.cajasPedidas;
    e.cajasEnviadas += l.cajasEnviadas;
    e.udsCanceladas += l.udsCanceladas;
  }
  return [...envios.values()];
}

// A tiempo = entrega real ≤ fecha prometida de JDE. Un envío ya enviado sin fecha real
// introducida queda "sin confirmar" (no cuenta ni como a tiempo ni como tarde).
export function estadoEntrega(e: { fechaEnvio: string | null; fechaPrometida: string | null }, entregaReal: string | null): EstadoEntrega {
  if (!e.fechaEnvio) return 'pendiente_envio';
  if (!entregaReal || !e.fechaPrometida) return 'sin_confirmar';
  return entregaReal <= e.fechaPrometida ? 'a_tiempo' : 'tarde';
}

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
}

// Resumen por pedido a partir de sus envíos (con el estado de entrega ya calculado).
// Completo = se ha enviado todo lo pedido. Entrega del pedido: cualquier envío tarde →
// tarde; si no, cualquiera sin confirmar → sin confirmar; si no, nada enviado →
// pendiente de envío; si no, a tiempo.
export function resumirPedidos(envios: { pedido: number; udsPedidas: number; udsEnviadas: number; cajasPedidas?: number; cajasEnviadas?: number; udsAfectadas?: number; cajasAfectadas?: number; fechaPrometida: string | null; entrega: EstadoEntrega }[]): PedidoResumen[] {
  const pedidos = new Map<number, PedidoResumen>();
  for (const e of envios) {
    const p = pedidos.get(e.pedido) ?? { pedido: e.pedido, udsPedidas: 0, udsEnviadas: 0, cajasPedidas: 0, cajasEnviadas: 0, cajasAfectadas: 0, udsAfectadas: 0, completo: false, fechaPrometida: null, entrega: 'pendiente_envio' as EstadoEntrega };
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
    else if (e.entrega === 'sin_confirmar' || p.entrega === 'sin_confirmar') p.entrega = 'sin_confirmar';
    else if (e.entrega === 'a_tiempo') p.entrega = 'a_tiempo';
    pedidos.set(e.pedido, p);
  }
  for (const p of pedidos.values()) p.completo = p.udsEnviadas >= p.udsPedidas;
  return [...pedidos.values()];
}

export interface Kpis {
  pedidos: number; // evaluados (los abiertos no cuentan)
  abiertos: number; // incompletos con fecha prometida aún no vencida
  confirmados: number; // evaluados con entrega a tiempo/tarde conocida
  sinConfirmar: number;
  pctATiempo: number | null;
  pctCompleto: number | null;
  pctOtif: number | null;
  udsPedidas: number;
  udsEnviadas: number;
  udsIncidencia: number; // no enviadas + afectadas (anotadas a mano)
  pctOtifUds: number | null; // 1 − uds con incidencia / uds pedidas
  cajasIncidencia: number; // no enviadas + afectadas, en cajas
  pctOtifCajas: number | null; // 1 − cajas con incidencia / cajas pedidas (Carrefour mide por cajas)
  cobertura: number | null; // % de pedidos evaluados con entrega confirmada: si es baja, el % a tiempo y el OTIF se apoyan en pocos datos
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

// Un pedido "abierto" (incompleto y con la fecha prometida aún por llegar) todavía puede
// cumplirse, así que no se evalúa. A tiempo y OTIF se miden solo sobre los pedidos con
// entrega confirmada; completo, sobre todos los evaluados.
export function calcularKpis(pedidos: PedidoResumen[], hoy: string): Kpis {
  const abierto = (p: PedidoResumen) => !p.completo && (!p.fechaPrometida || p.fechaPrometida >= hoy);
  const evaluados = pedidos.filter((p) => !abierto(p));
  const confirmados = evaluados.filter((p) => p.entrega === 'a_tiempo' || p.entrega === 'tarde');
  const aTiempo = confirmados.filter((p) => p.entrega === 'a_tiempo');
  const udsPedidas = evaluados.reduce((s, p) => s + p.udsPedidas, 0);
  const udsIncidencia = evaluados.reduce((s, p) => s + Math.max(0, p.udsPedidas - p.udsEnviadas) + p.udsAfectadas, 0);
  const cajasPedidas = evaluados.reduce((s, p) => s + p.cajasPedidas, 0);
  const cajasIncidencia = evaluados.reduce((s, p) => s + Math.max(0, p.cajasPedidas - p.cajasEnviadas) + p.cajasAfectadas, 0);
  return {
    pedidos: evaluados.length,
    abiertos: pedidos.length - evaluados.length,
    confirmados: confirmados.length,
    sinConfirmar: evaluados.filter((p) => p.entrega === 'sin_confirmar').length,
    pctATiempo: pct(aTiempo.length, confirmados.length),
    pctCompleto: pct(evaluados.filter((p) => p.completo).length, evaluados.length),
    pctOtif: pct(aTiempo.filter((p) => p.completo).length, confirmados.length),
    udsPedidas,
    udsEnviadas: evaluados.reduce((s, p) => s + p.udsEnviadas, 0),
    udsIncidencia,
    pctOtifUds: udsPedidas > 0 ? 100 - (udsIncidencia / udsPedidas) * 100 : null,
    cajasIncidencia,
    pctOtifCajas: cajasPedidas > 0 ? 100 - (cajasIncidencia / cajasPedidas) * 100 : null,
    cobertura: pct(confirmados.length, evaluados.length),
  };
}

// --- Indicadores (pestaña «Indicadores»): agregados por mes y canal ---------------------

type EnvioIndicadores = {
  pedido: number; canal: string | null; udsPedidas: number; udsEnviadas: number; udsAfectadas: number; udsCanceladas?: number;
  fechaPrometida: string | null; entrega: EstadoEntrega; motivo: string; responsable: string;
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

// Incidencias = envíos con motivo anotado. Cuenta por motivo o por responsable.
export function contarIncidencias(envios: EnvioIndicadores[], por: 'motivo' | 'responsable'): Record<string, number> {
  const r: Record<string, number> = {};
  for (const e of envios) {
    if (!motivoEfectivo(e)) continue;
    const clave = (por === 'motivo' ? motivoEfectivo(e) : responsableEfectivo(e)) || 'Sin indicar';
    r[clave] = (r[clave] ?? 0) + 1;
  }
  return r;
}

// Incidencias por mes (de la fecha prometida del envío) y motivo, para barras apiladas.
export function incidenciasPorMes(envios: EnvioIndicadores[]): { mes: string; [motivo: string]: string | number }[] {
  const meses = new Map<string, Record<string, number>>();
  for (const e of envios) {
    const mes = e.fechaPrometida?.slice(0, 7);
    const motivo = motivoEfectivo(e);
    if (!mes || !motivo) continue;
    const m = meses.get(mes) ?? {};
    m[motivo] = (m[motivo] ?? 0) + 1;
    meses.set(mes, m);
  }
  return [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, m]) => ({ mes, ...m }));
}

// Datos manuales de un envío tal como se guardan en SQLite (order_service_tracking).
export interface TrackingManual {
  transportista: string; fecha_entrega_real: string | null; responsable: string; motivo: string; incidencia: string; uds_afectadas: number; cajas_afectadas?: number;
}

// Cruza las líneas de JDE con los datos manuales y calcula todo lo que devuelve la API:
// envíos con estado de entrega, unidades del pedido completo y KPIs. Es la misma ruta
// para datos reales y de ejemplo (?mock=1), así que no hay lógica duplicada.
export function armarRespuesta(lineas: LineaJde[], tracking: Map<string, TrackingManual>, canalLabels: Record<string, string>, hoy: string) {
  const envios = agruparEnvios(lineas).map((e) => {
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
          const sinConfirmar = !problema && rnd() < 0.05;
          const real = sinConfirmar ? null : suma(prometida, llegaTarde ? 1 + Math.floor(rnd() * 3) : -Math.floor(rnd() * 2));
          const motivo = problema ? (llegaTarde && rnd() < 0.5 ? 'Transporte' : MOTIVOS_PESO[Math.floor(rnd() * MOTIVOS_PESO.length)]) : '';
          lineas.push({
            pedido, suPedido: `EJ-${pedido}`, albaran, cliente: 100 + (pedido % 40),
            clienteNombre: `Cliente ejemplo ${canal} ${pedido % 40}`, destino: 100 + (pedido % 40), destinoNombre: `Cliente ejemplo ${canal} ${pedido % 40}`,
            fechaEnvio: suma(prometida, -1), fechaPrometida: prometida,
            udsPedidas: Math.round(pedidas * parte), udsEnviadas: Math.round(enviadasTotal * parte), canal,
            udsCanceladas: incompleto && c === 0 && pedido % 3 === 0 ? Math.max(0, Math.round((pedidas - enviadasTotal) * parte)) : 0,
            cajasPedidas: Math.round((pedidas * parte) / 12), cajasEnviadas: Math.round((enviadasTotal * parte) / 12), // ejemplo: 12 uds por caja
          });
          tracking.set(`${pedido}|${albaran}`, {
            transportista: TRANSPORTISTAS[pedido % TRANSPORTISTAS.length], fecha_entrega_real: real,
            responsable: motivo ? MOTIVO_RESP[motivo].resp : '', motivo, incidencia: motivo ? MOTIVO_RESP[motivo].texto : '',
            ...(() => { const u = motivo ? 6 + Math.floor(rnd() * 90) : 0; return { uds_afectadas: u, cajas_afectadas: Math.round((u / 12) * 10) / 10 }; })(),
          });
        }
      }
    }
  }
  return { lineas, tracking };
}

// Cancelación del cliente: las unidades canceladas (SDSOCN) cuentan como falta de servicio pero la
// responsabilidad es del cliente, así que un envío con cancelaciones es una incidencia aunque nadie la haya
// anotado a mano: motivo «Cancelación del cliente» y responsable «Cliente» (lo anotado a mano manda).
export const MOTIVO_CANCELACION = 'Cancelación del cliente';
type ConIncidencia = { motivo: string; responsable?: string; incidencia: string; udsAfectadas: number; cajasAfectadas?: number; udsCanceladas?: number };
export const motivoEfectivo = (e: Pick<ConIncidencia, 'motivo' | 'udsCanceladas'>): string => e.motivo || ((e.udsCanceladas ?? 0) > 0 ? MOTIVO_CANCELACION : '');
export const responsableEfectivo = (e: Pick<ConIncidencia, 'responsable' | 'udsCanceladas'>): string => e.responsable || ((e.udsCanceladas ?? 0) > 0 ? 'Cliente' : '');

// Un envío «tiene incidencia» si se le ha anotado algo (motivo, texto o unidades afectadas) o tiene cancelaciones.
export function tieneIncidencia(e: ConIncidencia): boolean {
  return !!e.motivo || !!e.incidencia || e.udsAfectadas > 0 || (e.cajasAfectadas ?? 0) > 0 || (e.udsCanceladas ?? 0) > 0;
}
