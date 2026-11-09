// Presets de los paneles Nova: qué se guarda en presets.filters y cómo se resuelven las fechas.
// Lógica pura (sin React ni servidor) para poder probarla; la interfaz está en components/nova/presets.tsx.
// Ver components/nova/README.md § «Presets».
//
// Formato guardado (JSON en presets.filters): { v: 2, filtros: {...del panel}, fechas?: FechasPreset }.
// Un preset sin `v` es del formato anterior (los filtros a pelo, p. ej. { clientes: [...] } de /servicio)
// y se lee como si fueran sus `filtros`, sin fechas.

export interface Rango {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

// 'dia': el panel filtra por días (DateRangePicker). 'mes': por meses completos (MonthRangePicker), así
// que solo se le ofrecen periodos que empiezan y acaban en mes completo.
export type Granularidad = 'dia' | 'mes';

export const PERIODOS = {
  ultimos_7: { label: 'Últimos 7 días', soloDia: true },
  ultimos_30: { label: 'Últimos 30 días', soloDia: true },
  ultimos_90: { label: 'Últimos 90 días', soloDia: true },
  mes_actual: { label: 'Mes en curso', soloDia: false },
  mes_anterior: { label: 'Mes anterior', soloDia: false },
  ultimos_3_meses: { label: 'Últimos 3 meses (con el actual)', soloDia: false },
  ultimos_12_meses: { label: 'Últimos 12 meses (con el actual)', soloDia: false },
  anio_actual: { label: 'Año en curso (ene–dic)', soloDia: false },
  anio_anterior: { label: 'Año anterior', soloDia: false },
} as const;
export type Periodo = keyof typeof PERIODOS;

export type FechasPreset =
  | { tipo: 'fijas'; desde: string; hasta: string }
  | { tipo: 'relativas'; periodo: Periodo };

export interface ContenidoPreset<F> {
  v: 2;
  filtros: Partial<F>;
  fechas?: FechasPreset;
}

// Lo que recibe el panel al aplicar un preset: sus filtros y, si el preset las tiene, las fechas ya
// resueltas a un rango concreto. Partial porque un preset viejo puede no tener los filtros nuevos.
export interface Aplicacion<F> {
  filtros: Partial<F>;
  fechas?: Rango;
}

// Cómo guardar las fechas: sin ellas, el rango exacto actual o un periodo relativo
export type ModoFechas = 'sin' | 'fijas' | Periodo;

export const periodosPara = (g: Granularidad): Periodo[] =>
  (Object.keys(PERIODOS) as Periodo[]).filter((p) => g === 'dia' || !PERIODOS[p].soloDia);

const pad = (n: number) => String(n).padStart(2, '0');
// Fecha local (no toISOString, que pasa a UTC y puede cambiar el día)
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const primerDia = (y: number, m: number) => iso(new Date(y, m, 1));
const ultimoDia = (y: number, m: number) => iso(new Date(y, m + 1, 0)); // día 0 del mes siguiente

export function resolverFechas(f: FechasPreset, hoy: Date = new Date()): Rango {
  if (f.tipo === 'fijas') return { startDate: f.desde, endDate: f.hasta };
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const haceDias = (n: number) => iso(new Date(y, m, hoy.getDate() - (n - 1)));
  switch (f.periodo) {
    case 'ultimos_7': return { startDate: haceDias(7), endDate: iso(hoy) };
    case 'ultimos_30': return { startDate: haceDias(30), endDate: iso(hoy) };
    case 'ultimos_90': return { startDate: haceDias(90), endDate: iso(hoy) };
    case 'mes_actual': return { startDate: primerDia(y, m), endDate: ultimoDia(y, m) };
    case 'mes_anterior': return { startDate: primerDia(y, m - 1), endDate: ultimoDia(y, m - 1) };
    case 'ultimos_3_meses': return { startDate: primerDia(y, m - 2), endDate: ultimoDia(y, m) };
    case 'ultimos_12_meses': return { startDate: primerDia(y, m - 11), endDate: ultimoDia(y, m) };
    case 'anio_actual': return { startDate: primerDia(y, 0), endDate: ultimoDia(y, 11) };
    case 'anio_anterior': return { startDate: primerDia(y - 1, 0), endDate: ultimoDia(y - 1, 11) };
  }
}

export function crearContenido<F>(filtros: F, modo: ModoFechas, fechasActuales: Rango | null): ContenidoPreset<F> {
  if (modo === 'sin') return { v: 2, filtros };
  if (modo === 'fijas') {
    if (!fechasActuales) return { v: 2, filtros };
    return { v: 2, filtros, fechas: { tipo: 'fijas', desde: fechasActuales.startDate, hasta: fechasActuales.endDate } };
  }
  return { v: 2, filtros, fechas: { tipo: 'relativas', periodo: modo } };
}

// Un JSON roto o con fechas que no se entienden no rompe el panel: se lee lo que se pueda.
export function leerPreset<F>(filters: string): ContenidoPreset<F> {
  let obj: unknown;
  try { obj = JSON.parse(filters); } catch { return { v: 2, filtros: {} }; }
  if (!obj || typeof obj !== 'object') return { v: 2, filtros: {} };
  const o = obj as Record<string, unknown>;
  if (o.v !== 2) return { v: 2, filtros: o as Partial<F> };
  const filtros = (o.filtros && typeof o.filtros === 'object' ? o.filtros : {}) as Partial<F>;
  const f = o.fechas as Record<string, unknown> | undefined;
  const fechaValida = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (f?.tipo === 'fijas' && fechaValida(f.desde) && fechaValida(f.hasta)) {
    return { v: 2, filtros, fechas: { tipo: 'fijas', desde: f.desde as string, hasta: f.hasta as string } };
  }
  if (f?.tipo === 'relativas' && typeof f.periodo === 'string' && f.periodo in PERIODOS) {
    return { v: 2, filtros, fechas: { tipo: 'relativas', periodo: f.periodo as Periodo } };
  }
  return { v: 2, filtros };
}

export const aplicacionDe = <F>(c: ContenidoPreset<F>, hoy: Date = new Date()): Aplicacion<F> =>
  c.fechas ? { filtros: c.filtros, fechas: resolverFechas(c.fechas, hoy) } : { filtros: c.filtros };

// ¿Lo que hay ahora en el panel es lo que guarda el filtro? Para mostrar «modificado» en el botón.
// Compara solo los filtros que tiene el panel (un filtro guardado viejo puede no tener alguno) y las
// fechas solo si el filtro las guarda. Las listas se comparan sin orden (elegir A y luego B = B y A).
export function coincide<F extends object>(c: ContenidoPreset<F>, actual: { filtros: F; fechas: Rango | null }, hoy: Date = new Date()): boolean {
  // «No lo tiene», null, false, "" y [] son lo mismo: un filtro guardado antes de existir un filtro nuevo
  // (p. ej. `excluir` en /servicio) coincide mientras ese filtro siga en su valor por defecto.
  const vacio = (v: unknown) => v === undefined || v === null || v === false || v === "" || (Array.isArray(v) && v.length === 0);
  const norm = (v: unknown) => (vacio(v) ? "∅" : JSON.stringify(Array.isArray(v) ? [...v].sort() : v));
  const guardados = c.filtros as Record<string, unknown>;
  const iguales = Object.entries(actual.filtros).every(([k, v]) => norm(guardados[k]) === norm(v));
  if (!iguales || !c.fechas) return iguales;
  const r = resolverFechas(c.fechas, hoy);
  return !!actual.fechas && actual.fechas.startDate === r.startDate && actual.fechas.endDate === r.endDate;
}

export const modoDe = (c: ContenidoPreset<unknown>): ModoFechas =>
  !c.fechas ? 'sin' : c.fechas.tipo === 'fijas' ? 'fijas' : c.fechas.periodo;

const fmt = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;
export const describirRango = (r: Rango) => `${fmt(r.startDate)} – ${fmt(r.endDate)}`;

export function describirFechas(f: FechasPreset | undefined): string {
  if (!f) return 'Sin fechas';
  return f.tipo === 'fijas' ? describirRango({ startDate: f.desde, endDate: f.hasta }) : PERIODOS[f.periodo].label;
}
