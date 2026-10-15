import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { parseJdeDate, getDayOfYear } from '@/lib/utils';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

// Panel de Compras (previsión vs. venta real): jerarquía Familia > Canal > Artículo,
// sobre el sistema Nova (ShadcnSpace) — sustituye a la versión anterior (agrupada por
// Familia/Marca, sin jerarquía). Ver components/nova/README.md (mecanismo de aislamiento
// visual), docs/compras.md (documentación completa) y docs/compras-v1-historico.md
// (conocimiento JDE de la versión anterior que sigue vigente aquí: mapeo artículo
// largo/corto, filtro SDNXTR, COLEDG_VIGENTE...) para el porqué de cada campo:
//
// - Familia: F4101.IMSRP2 es un CÓDIGO (ej. "101"), validado contra UDC 41/S2 —
//   resuelto contra prodctl.f0005 (getCanalLabels-style), nunca el código crudo.
// - Canal: F554101.AAZE06, validado contra UDC 17/B6 — es un atributo del ARTÍCULO
//   (como el gramaje), no del cliente. Un artículo pertenece a un único canal; sus
//   ventas se atribuyen íntegramente a él, independientemente del cliente que compre.
//   PENDIENTE DE VALIDAR CON COMERCIAL.
// - Previsión: F3460 (artículo × mes, planta 10999). MFAN8 (cliente) existe en la
//   tabla pero vale 0 en todas las filas de esta planta — sin desglose de cliente,
//   pero SÍ hereda canal y familia (vía el artículo).
// - Venta real: F4211, mismo filtro que la versión anterior (SDDCTO != 'ST', SDADDJ != 0).
// - Kg: F554101.AAZE03 (gramos/unidad). Si un artículo no tiene gramaje, su kg queda
//   `null` y se excluye de las sumas de kg — se reporta en `articulosSinGramaje`.
// - Importe (€): previsto = unidades previstas × coste unitario fijo (F4105.COUNCS,
//   una foto por artículo sin mes propio, igual que la versión anterior);
//   real = línea a línea (F4211.SDSOQS × SDUPRC), NUNCA unidades reales × coste — el
//   precio de venta real no es el coste presupuestado. Si un artículo no tiene fila en
//   F4105, su importe PREVISTO queda a 0 (no hay con qué calcularlo) — se reporta en
//   `articulosSinCoste` — pero su importe REAL se suma con normalidad: no depende del
//   coste, solo de F4211. (Bug real corregido: antes se excluía también el real.)
// - Mensual (para "Evolución mensual"): misma lógica de abajo arriba, por mes, a 3
//   niveles (total, por familia, por familia+canal) en unidades, kg e importe.
//
// Modo de datos de ejemplo: ?mock=1 devuelve una jerarquía completa generada en código
// (sin tocar Oracle). Usa la MISMA función de agregación que el camino real. Solo
// accesible por URL — no hay botón en la UI (decisión del usuario).

const PLANTA_PRESUPUESTOS = 10999;
const TIPO_DOC_EXCLUIDO = 'ST';
const UMBRAL_DEFAULT_PCT = 10;
const TIPOS_PREVISION = ['PN', 'PM'] as const;
const TIPO_PREVISION_DEFAULT = 'PM';
const SIN_SABOR = 'Sin sabor';
// ponytail: tipo de coste vigente en F4105 (COLEDG). JDE lo cambia cada año (P6=2026)
// y no hay un patrón año->código confirmado. Actualizar a mano cada enero — mismo
// mecanismo que api/compras/route.ts (v1), ver docs/compras.md §3.4.
const COLEDG_VIGENTE = 'P6';

// Orden fijo de familias (no alfabético) para que tabla y gráfico de desviación se
// puedan cruzar fila a fila. Familias que aparezcan en los datos pero no en esta lista
// (nuevas, o "Sin familia") van al final, alfabéticas entre sí — nunca se descartan.
const FAMILIA_ORDEN = ['Tortilla', 'Pimiento asado', 'Preparados a base de patata', 'Migas', 'Verduras', 'Otros'];
function ordenFamilia(familia: string): number {
  const i = FAMILIA_ORDEN.indexOf(familia);
  return i === -1 ? FAMILIA_ORDEN.length : i;
}

const MES_LABEL = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

interface Metric {
  previsto: number;
  real: number;
  desviacionAbs: number;
  desviacionPct: number | null;
}

function buildMetric(previsto: number, real: number): Metric {
  const desviacionAbs = real - previsto;
  const desviacionPct = previsto !== 0 ? (desviacionAbs / previsto) * 100 : null;
  return { previsto, real, desviacionAbs, desviacionPct };
}

interface MesPunto {
  sortKey: string; // 'YYYY-MM', para ordenar cronológicamente
  mes: string; // etiqueta corta ('ene', 'feb'...) para el eje X
  previsto: number; // unidades
  real: number; // unidades
  importeReal: number; // € reales del mes, acumulado línea a línea (SDUORG × SDUPRC)
}

interface ArticuloAgg {
  item: string;
  descripcion: string;
  familia: string;
  canal: string | null;
  gramaje: number | null;
  costeUnitario: number | null; // F4105.COUNCS — foto por artículo, sin mes propio
  meses: MesPunto[]; // el total del periodo es la suma de estos meses (nunca un dato aparte)
}

function totalUnidades(a: ArticuloAgg) {
  return {
    previsto: a.meses.reduce((s, m) => s + m.previsto, 0),
    real: a.meses.reduce((s, m) => s + m.real, 0),
  };
}

// Importe de un artículo para el periodo completo. Asimétrico a propósito: previsto
// sale de multiplicar (coste fijo), real sale de sumar (ya viene precio por línea) — no
// son la misma operación, así que no se puede reutilizar totalUnidades()+multiplicar
// para los dos lados como si fuera kg.
//
// Bug real encontrado comparando contra la versión anterior (docs/compras-v1-historico.md):
// aquí se descartaba TODO el importe (previsto Y real) si el artículo no tenía coste en
// F4105, aunque el real no dependa del coste — se perdía importe real de ventas conocidas
// solo por faltar el coste presupuestado. Ahora solo el previsto queda a 0 (sin coste no
// hay con qué calcularlo); el real se suma siempre que haya ventas, igual que hacía la
// versión anterior (`importeReal = b.hasReal ? b.realImporte : null`, independiente del coste).
function totalImporteArticulo(a: ArticuloAgg): { previsto: number; real: number } {
  const unidadesPrevisto = a.meses.reduce((s, m) => s + m.previsto, 0);
  const importeReal = a.meses.reduce((s, m) => s + m.importeReal, 0);
  const previsto = a.costeUnitario != null ? unidadesPrevisto * a.costeUnitario : 0;
  return { previsto, real: importeReal };
}

// Serie mensual agregada (abajo arriba) para un subconjunto de artículos — la usan tanto
// el total general como cada familia/canal. Un mes en el que ningún artículo del
// subconjunto tiene fila se omite (no se rellena con 0 fantasma).
function mensualDe(articulos: { meses: { sortKey: string; mes: string; previsto: number; real: number }[] }[]): MesPunto[] {
  const porMes = new Map<string, { mes: string; previsto: number; real: number }>();
  for (const a of articulos) {
    for (const m of a.meses) {
      const acc = porMes.get(m.sortKey) ?? { mes: m.mes, previsto: 0, real: 0 };
      acc.previsto += m.previsto;
      acc.real += m.real;
      porMes.set(m.sortKey, acc);
    }
  }
  return Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sortKey, v]) => ({ sortKey, ...v, importeReal: 0 }));
}

function mensualKgDe(articulos: ArticuloAgg[]): MesPunto[] | null {
  const conGramaje = articulos.filter((a) => a.gramaje != null);
  if (conGramaje.length === 0) return null;
  const enKg = conGramaje.map((a) => ({
    ...a,
    meses: a.meses.map((m) => ({ ...m, previsto: (m.previsto * a.gramaje!) / 1000, real: (m.real * a.gramaje!) / 1000 })),
  }));
  return mensualDe(enKg);
}

// Igual patrón que mensualKgDe, pero asimétrico: previsto = unidades del mes × coste
// fijo, real = importeReal del mes ya acumulado línea a línea (no se multiplica nada).
function mensualImporteDe(articulos: ArticuloAgg[]): MesPunto[] | null {
  if (articulos.length === 0) return null;
  // Mismo fix que totalImporteArticulo: no excluir el real de un mes solo porque el
  // artículo no tenga coste — el previsto de ese mes queda a 0, el real se suma igual.
  const enImporte = articulos.map((a) => ({
    ...a,
    meses: a.meses.map((m) => ({
      ...m,
      previsto: a.costeUnitario != null ? m.previsto * a.costeUnitario : 0,
      real: m.importeReal,
    })),
  }));
  return mensualDe(enImporte);
}

// Agregación de abajo arriba: artículo -> canal -> familia -> total, en unidades, kg,
// importe y series mensuales. Es la MISMA función para datos reales y para el modo
// mock, para que los totales cuadren por construcción en ambos casos.
// `canalLabels`: código (AAZE06) -> descripción de la UDC 17/B6 (prodctl.f0005.DRDL01).
function aggregate(articulos: ArticuloAgg[], umbralPct: number, canalLabels: Map<string, string>) {
  const articulosSinGramaje = new Set<string>();
  const articulosSinCoste = new Set<string>();

  const familiaMap = new Map<string, Map<string | null, ArticuloAgg[]>>();
  for (const a of articulos) {
    if (!familiaMap.has(a.familia)) familiaMap.set(a.familia, new Map());
    const canalMap = familiaMap.get(a.familia)!;
    if (!canalMap.has(a.canal)) canalMap.set(a.canal, []);
    canalMap.get(a.canal)!.push(a);
    if (a.gramaje == null) articulosSinGramaje.add(a.item);
    if (a.costeUnitario == null) articulosSinCoste.add(a.item);
  }

  const mensualPorFamilia: Record<string, MesPunto[]> = {};
  const mensualPorFamiliaCanal: Record<string, MesPunto[]> = {};
  const mensualKgPorFamilia: Record<string, MesPunto[] | null> = {};
  const mensualKgPorFamiliaCanal: Record<string, MesPunto[] | null> = {};
  const mensualImportePorFamilia: Record<string, MesPunto[] | null> = {};
  const mensualImportePorFamiliaCanal: Record<string, MesPunto[] | null> = {};

  const familias = Array.from(familiaMap.entries()).map(([familia, canalMap]) => {
    const articulosFamilia: ArticuloAgg[] = [];
    const canales = Array.from(canalMap.entries()).map(([canal, arts]) => {
      articulosFamilia.push(...arts);
      const articulosRow = arts.map((a) => {
        const t = totalUnidades(a);
        const unidades = buildMetric(t.previsto, t.real);
        const kg = a.gramaje != null ? buildMetric((t.previsto * a.gramaje) / 1000, (t.real * a.gramaje) / 1000) : null;
        const importeTotal = totalImporteArticulo(a);
        const importe = buildMetric(importeTotal.previsto, importeTotal.real);
        return { tipo: 'articulo' as const, item: a.item, descripcion: a.descripcion, gramaje: a.gramaje, unidades, kg, importe };
      });

      const unidadesCanal = buildMetric(
        articulosRow.reduce((s, r) => s + r.unidades.previsto, 0),
        articulosRow.reduce((s, r) => s + r.unidades.real, 0)
      );
      const conKg = articulosRow.filter((r) => r.kg != null);
      const kgCanal = conKg.length > 0
        ? buildMetric(conKg.reduce((s, r) => s + r.kg!.previsto, 0), conKg.reduce((s, r) => s + r.kg!.real, 0))
        : null;
      const conImporte = articulosRow.filter((r) => r.importe != null);
      const importeCanal = conImporte.length > 0
        ? buildMetric(conImporte.reduce((s, r) => s + r.importe!.previsto, 0), conImporte.reduce((s, r) => s + r.importe!.real, 0))
        : null;

      // Mismo sentinel que components/nova/hierarchical-table.tsx (toTree) y el
      // estado `drill` de la página — una sola forma de nombrar "sin canal" en todo
      // el flujo tabla <-> API <-> gráfico.
      const claveCanal = `${familia}::${canal ?? '__sin_canal__'}`;
      mensualPorFamiliaCanal[claveCanal] = mensualDe(arts);
      mensualKgPorFamiliaCanal[claveCanal] = mensualKgDe(arts);
      mensualImportePorFamiliaCanal[claveCanal] = mensualImporteDe(arts);

      const canalLabel = canal ? (canalLabels.get(canal) ?? canal) : 'Sin canal';
      return { tipo: 'canal' as const, canal, canalLabel, unidades: unidadesCanal, kg: kgCanal, importe: importeCanal, articulos: articulosRow };
    });

    const unidadesFamilia = buildMetric(
      canales.reduce((s, c) => s + c.unidades.previsto, 0),
      canales.reduce((s, c) => s + c.unidades.real, 0)
    );
    const canalesConKg = canales.filter((c) => c.kg != null);
    const kgFamilia = canalesConKg.length > 0
      ? buildMetric(canalesConKg.reduce((s, c) => s + c.kg!.previsto, 0), canalesConKg.reduce((s, c) => s + c.kg!.real, 0))
      : null;
    const canalesConImporte = canales.filter((c) => c.importe != null);
    const importeFamilia = canalesConImporte.length > 0
      ? buildMetric(canalesConImporte.reduce((s, c) => s + c.importe!.previsto, 0), canalesConImporte.reduce((s, c) => s + c.importe!.real, 0))
      : null;

    mensualPorFamilia[familia] = mensualDe(articulosFamilia);
    mensualKgPorFamilia[familia] = mensualKgDe(articulosFamilia);
    mensualImportePorFamilia[familia] = mensualImporteDe(articulosFamilia);

    return { tipo: 'familia' as const, familia, unidades: unidadesFamilia, kg: kgFamilia, importe: importeFamilia, canales };
  }).sort((a, b) => ordenFamilia(a.familia) - ordenFamilia(b.familia) || a.familia.localeCompare(b.familia));

  const totalU = buildMetric(
    familias.reduce((s, f) => s + f.unidades.previsto, 0),
    familias.reduce((s, f) => s + f.unidades.real, 0)
  );
  const familiasConKg = familias.filter((f) => f.kg != null);
  const totalKg = familiasConKg.length > 0
    ? buildMetric(familiasConKg.reduce((s, f) => s + f.kg!.previsto, 0), familiasConKg.reduce((s, f) => s + f.kg!.real, 0))
    : null;
  const familiasConImporte = familias.filter((f) => f.importe != null);
  const totalImporte = familiasConImporte.length > 0
    ? buildMetric(familiasConImporte.reduce((s, f) => s + f.importe!.previsto, 0), familiasConImporte.reduce((s, f) => s + f.importe!.real, 0))
    : null;

  const familiasFueraDeUmbral = familias.filter(
    (f) => f.unidades.desviacionPct != null && Math.abs(f.unidades.desviacionPct) > umbralPct
  ).length;

  return {
    familias,
    resumen: {
      unidades: totalU,
      kg: totalKg,
      importe: totalImporte,
      totalFamilias: familias.length,
      familiasFueraDeUmbral,
      umbralPct,
      articulosSinGramaje: Array.from(articulosSinGramaje).sort(),
      articulosSinCoste: Array.from(articulosSinCoste).sort(),
    },
    mensual: {
      total: mensualDe(articulos),
      totalKg: mensualKgDe(articulos),
      totalImporte: mensualImporteDe(articulos),
      porFamilia: mensualPorFamilia,
      porFamiliaCanal: mensualPorFamiliaCanal,
      kgPorFamilia: mensualKgPorFamilia,
      kgPorFamiliaCanal: mensualKgPorFamiliaCanal,
      importePorFamilia: mensualImportePorFamilia,
      importePorFamiliaCanal: mensualImportePorFamiliaCanal,
    },
  };
}

// --- Modo de datos de ejemplo -----------------------------------------------------
// Reparto mensual determinista (no aleatorio, para que el mock sea estable entre
// recargas): dos curvas de peso ligeramente distintas para previsto/real, sobre una
// campaña sep-2025..ago-2026, así el gráfico mensual no es una simple línea recta.
const PESO_PREV = [0.095, 0.085, 0.09, 0.10, 0.07, 0.065, 0.075, 0.08, 0.085, 0.09, 0.08, 0.085];
const PESO_REAL = [0.10, 0.09, 0.10, 0.11, 0.065, 0.055, 0.07, 0.075, 0.09, 0.095, 0.075, 0.075];
const CAMPANA: { sortKey: string; mes: string }[] = [
  { sortKey: '2025-09', mes: 'sep' }, { sortKey: '2025-10', mes: 'oct' }, { sortKey: '2025-11', mes: 'nov' },
  { sortKey: '2025-12', mes: 'dic' }, { sortKey: '2026-01', mes: 'ene' }, { sortKey: '2026-02', mes: 'feb' },
  { sortKey: '2026-03', mes: 'mar' }, { sortKey: '2026-04', mes: 'abr' }, { sortKey: '2026-05', mes: 'may' },
  { sortKey: '2026-06', mes: 'jun' }, { sortKey: '2026-07', mes: 'jul' }, { sortKey: '2026-08', mes: 'ago' },
];

function repartirMeses(previstoTotal: number, realTotal: number, costeUnitario: number | null): MesPunto[] {
  return CAMPANA.map((c, i) => {
    const previsto = Math.round(previstoTotal * PESO_PREV[i]);
    const real = Math.round(realTotal * PESO_REAL[i]);
    return {
      sortKey: c.sortKey,
      mes: c.mes,
      previsto,
      real,
      // Mock: precio real = coste fijo (sin variación de precio simulada) — suficiente
      // para validar la interacción, no para representar una desviación de precio real.
      importeReal: costeUnitario != null ? real * costeUnitario : 0,
    };
  });
}

// Descripciones del catálogo UDC 17/B6 confirmadas contra el esquema real (ver
// conversación de mapeo de datos) — hardcodeadas SOLO aquí, dentro de los datos de
// ejemplo. El camino real nunca hardcodea esto: consulta prodctl.f0005 en vivo.
const MOCK_CANAL_LABELS = new Map([
  ['EXP', 'Exportación'],
  ['HOR', 'Horeca'],
  ['MLPC', 'Mercadona LPC'],
  ['MLS', 'Mercadona Libre Servicio'],
  ['RET', 'Retail'],
]);

function getMockArticulos(): ArticuloAgg[] {
  const base = [
    { item: '1210100009', descripcion: 'TORT CHORIZO 600g FR BF', familia: 'Tortilla', canal: 'HOR', gramaje: 600, coste: 2.1, unidadesPrevisto: 210000, unidadesReal: 228000 },
    { item: '1210100010', descripcion: 'TORT CEBOLLA 1Kg FR BF', familia: 'Tortilla', canal: 'RET', gramaje: 1000, coste: 3.4, unidadesPrevisto: 250000, unidadesReal: 265000 },
    { item: '1210100011', descripcion: 'TORT POMME T 500g TP GS', familia: 'Tortilla', canal: 'MLS', gramaje: 500, coste: 1.8, unidadesPrevisto: 145200, unidadesReal: 160170 },
    { item: '1310200004', descripcion: 'PIM ASADO TIRAS 500g FR BF', familia: 'Pimiento asado', canal: 'RET', gramaje: 500, coste: 2.6, unidadesPrevisto: 22100, unidadesReal: 19370 },
    { item: '1310200007', descripcion: 'PIM ASADO ENTERO 1Kg TP GS', familia: 'Pimiento asado', canal: 'RET', gramaje: 1000, coste: 4.2, unidadesPrevisto: 31000, unidadesReal: 25340 },
    { item: '1310200011', descripcion: 'PIM ASADO TIRAS 800g FR BF', familia: 'Pimiento asado', canal: 'HOR', gramaje: 800, coste: 3.5, unidadesPrevisto: 85700, unidadesReal: 96030 },
    { item: '1310200015', descripcion: 'PIM ASADO GRANEL 5Kg FR BF', familia: 'Pimiento asado', canal: null, gramaje: null, coste: null, unidadesPrevisto: 220200, unidadesReal: 252900 },
    { item: '1410300002', descripcion: 'PREP PATATA GAJO 750g FR BF', familia: 'Preparados a base de patata', canal: 'HOR', gramaje: 750, coste: 1.5, unidadesPrevisto: 180000, unidadesReal: 181080 },
    { item: '1410300006', descripcion: 'PREP PATATA CUBO 1Kg TP GS', familia: 'Preparados a base de patata', canal: 'MLPC', gramaje: 1000, coste: 1.9, unidadesPrevisto: 96000, unidadesReal: 96580 },
    { item: '1510400003', descripcion: 'MIGAS TRADICIONAL 600g FR BF', familia: 'Migas', canal: 'RET', gramaje: 600, coste: 2.2, unidadesPrevisto: 140000, unidadesReal: 136360 },
    { item: '1610500001', descripcion: 'VERDURAS SALTEADAS 500g FR BF', familia: 'Verduras', canal: 'MLS', gramaje: 500, coste: 2.0, unidadesPrevisto: 98000, unidadesReal: 109466 },
    { item: '1610500005', descripcion: 'VERDURAS PARRILLA 400g TP GS', familia: 'Verduras', canal: 'EXP', gramaje: 400, coste: 1.7, unidadesPrevisto: 42000, unidadesReal: 46914 },
    { item: '1710600002', descripcion: 'OTROS SURTIDO 300g FR BF', familia: 'Otros', canal: 'HOR', gramaje: 300, coste: 1.3, unidadesPrevisto: 61000, unidadesReal: 67405 },
  ];
  return base.map((b) => ({
    item: b.item,
    descripcion: b.descripcion,
    familia: b.familia,
    canal: b.canal,
    gramaje: b.gramaje,
    costeUnitario: b.coste,
    meses: repartirMeses(b.unidadesPrevisto, b.unidadesReal, b.coste),
  }));
}

// --- Modo real -----------------------------------------------------------------
function jdeBoundsFromDates(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  const startJde = 100000 + (start.getFullYear() - 2000) * 1000 + getDayOfYear(start);
  const endJde = 100000 + (end.getFullYear() - 2000) * 1000 + getDayOfYear(end);
  return { startJde, endJde };
}

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('compras');
  if (denied) return denied;
  const startTime = Date.now();

  const { searchParams } = new URL(req.url);
  const umbralPct = Number(searchParams.get('umbral')) || UMBRAL_DEFAULT_PCT;
  // Lista cerrada: cualquier otro valor cae al por defecto (nunca llega a la query).
  const tipoParam = searchParams.get('tipoPrevision');
  const tipoPrev = TIPOS_PREVISION.find((t) => t === tipoParam) ?? TIPO_PREVISION_DEFAULT;
  const sabor = (searchParams.get('sabor') || '').trim().slice(0, 100); // '' = todos

  if (searchParams.get('mock') === '1') {
    return NextResponse.json({ mock: true, ...aggregate(getMockArticulos(), umbralPct, MOCK_CANAL_LABELS), sabores: [] });
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthEndStr = `${monthEnd.getFullYear()}-${String(monthEnd.getMonth() + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;
  const startDateStr = searchParams.get('startDate') || monthStart;
  const endDateStr = searchParams.get('endDate') || monthEndStr;
  const { startJde, endJde } = jdeBoundsFromDates(startDateStr, endDateStr);

  let conn;
  try {
    conn = await getDbConnection();

    // A) Previsión (F3460) — artículo largo (MFLITM) x mes, planta de presupuestos.
    // MFTYPF: PN = previsión original, PM = modificada — nunca se suman (serían dos
    // versiones de la misma previsión).
    const forecastSql = `
      SELECT TRIM(MFLITM) AS ITEM, TRIM(MFITM) AS ITEM_CORTO, MFDRQJ AS FECHA_JDE, MFFQT AS CANT_PREV_RAW
      FROM F3460
      WHERE MFMCU = :planta AND MFDRQJ BETWEEN :startJde AND :endJde AND TRIM(MFTYPF) = :tipoPrev
    `;
    // B) Venta real (F4211) — mismo filtro que la v1 del panel. Se AGREGA EN ORACLE por
    // artículo x mes (antes se traía una fila por línea de pedido y se sumaba en JS: era lo
    // que hacía lenta la carga en rangos amplios). SDSOQS = cantidad (×100); el importe es
    // SUM(SDSOQS × SDUPRC) línea a línea (SDUPRC = precio unitario ×10000, NUNCA cantidad ×
    // coste presupuestado), así que IMPORTE_RAW viene ×1.000.000. El mes sale de la fecha
    // JDE (CYYDDD): 1900000 + CYYDDD = YYYYDDD, que TO_DATE entiende sin depender del NLS.
    const mesVentaSql = `TO_CHAR(TO_DATE(TO_CHAR(A.SDADDJ + 1900000), 'YYYYDDD'), 'YYYYMM')`;
    const salesSql = `
      SELECT TRIM(A.SDAITM) AS ITEM, TRIM(A.SDITM) AS ITEM_CORTO, ${mesVentaSql} AS MES,
             SUM(A.SDSOQS) AS CANT_REAL_RAW, SUM(A.SDSOQS * A.SDUPRC) AS IMPORTE_RAW
      FROM F4211 A
      WHERE TRIM(A.SDDCTO) != :tipoDocExcluido AND A.SDADDJ != 0
        AND A.SDADDJ BETWEEN :startJde AND :endJde
      GROUP BY TRIM(A.SDAITM), TRIM(A.SDITM), ${mesVentaSql}
    `;

    const [forecastResult, salesResult] = await Promise.all([
      conn.execute(forecastSql, { planta: PLANTA_PRESUPUESTOS, startJde, endJde, tipoPrev }),
      conn.execute(salesSql, { tipoDocExcluido: TIPO_DOC_EXCLUIDO, startJde, endJde }),
    ]);

    const forecastRows = forecastResult.rows as any[];
    const salesRows = salesResult.rows as any[];

    // Artículo largo -> corto (F4101/F554101 se indexan por el corto, ver docs/compras.md §3.1)
    const shortItemMap = new Map<string, string>();
    forecastRows.forEach((r) => {
      const item = String(r.ITEM).trim();
      const corto = String(r.ITEM_CORTO || '').trim();
      if (item && corto && !shortItemMap.has(item)) shortItemMap.set(item, corto);
    });
    salesRows.forEach((r) => {
      const item = String(r.ITEM).trim();
      const corto = String(r.ITEM_CORTO || '').trim();
      if (item && corto && !shortItemMap.has(item)) shortItemMap.set(item, corto);
    });

    const longItemIds = Array.from(shortItemMap.keys());
    const itemIds = Array.from(new Set(Array.from(shortItemMap.values()))).filter(Boolean);
    if (itemIds.length === 0) {
      return NextResponse.json({ mock: false, ...aggregate([], umbralPct, new Map()), sabores: [] });
    }

    const idBinds: any = {};
    itemIds.forEach((id, i) => { idBinds[`id${i}`] = id; });
    const idPlaceholders = itemIds.map((_, i) => `:id${i}`).join(', ');

    const longIdBinds: any = {};
    longItemIds.forEach((id, i) => { longIdBinds[`lid${i}`] = id; });
    const longIdPlaceholders = longItemIds.map((_, i) => `:lid${i}`).join(', ');

    // C) Familia (F4101.IMSRP2, UDC 41/S2 — mismo patrón que /produccion). IMSRP2 es
    // un CÓDIGO (ej. "101"), no la descripción — mismo error que se cometió con canal,
    // hace falta resolverlo contra el catálogo (bug real, solo visible con datos reales:
    // el mock tenía los nombres ya escritos a mano, nunca pasó por esta ruta).
    // Sabor = IMSRP5 (UDC 41/S5), mismo campo que el filtro "Sabor" de /produccion.
    const metaSql = `SELECT TRIM(IMITM) AS ITEM, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA, TRIM(IMSRP5) AS SABOR FROM F4101 WHERE IMITM IN (${idPlaceholders})`;
    // D) Canal (F554101.AAZE06, UDC 17/B6) + gramaje (F554101.AAZE03)
    const extSql = `SELECT TRIM(AAITM) AS ITEM, TRIM(AAZE06) AS CANAL, TRIM(AAZE03) AS GRAMOS_RAW FROM F554101 WHERE AAITM IN (${idPlaceholders})`;
    // E) Catálogo de canal (UDC 17/B6) — descripción real, nunca el código.
    const canalCatalogSql = `
      SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION
      FROM prodctl.f0005
      WHERE TRIM(DRSY) = '17' AND TRIM(DRRT) = 'B6' AND TRIM(DRKY) IS NOT NULL
    `;
    // F) Catálogo de familia (UDC 41/S2) — igual que el de canal.
    const familiaCatalogSql = `
      SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION
      FROM prodctl.f0005
      WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S2' AND TRIM(DRKY) IS NOT NULL
    `;
    // F2) Catálogo de sabor (UDC 41/S5).
    const saborCatalogSql = `
      SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION
      FROM prodctl.f0005
      WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S5' AND TRIM(DRKY) IS NOT NULL
    `;
    // G) Coste unitario vigente (F4105) — no tiene granularidad mensual. COLITM es el
    // artículo LARGO (mismo espacio que MFLITM/SDAITM), no requiere traducción a corto
    // (mismo patrón que api/compras/route.ts v1).
    const costSql = `
      SELECT TRIM(COLITM) AS ITEM, COUNCS AS COSTE_RAW
      FROM F4105
      WHERE COMCU = :planta AND COLEDG = :coledg AND TRIM(COLITM) IN (${longIdPlaceholders})
    `;

    const [metaResult, extResult, canalCatalogResult, familiaCatalogResult, saborCatalogResult, costResult] = await Promise.all([
      conn.execute(metaSql, idBinds),
      conn.execute(extSql, idBinds),
      conn.execute(canalCatalogSql),
      conn.execute(familiaCatalogSql),
      conn.execute(saborCatalogSql),
      conn.execute(costSql, { planta: PLANTA_PRESUPUESTOS, coledg: COLEDG_VIGENTE, ...longIdBinds }),
    ]);

    const canalLabels = new Map<string, string>();
    (canalCatalogResult.rows as any[]).forEach((r) => {
      canalLabels.set(String(r.CODE).trim(), String(r.DESCRIPCION || '').trim());
    });

    // La UDC 41/S2 la tiene JDE en mayúsculas ("TORTILLA"), a diferencia de 17/B6 que
    // ya viene bien formateada ("Horeca") — comprobado contra el esquema real. Solo
    // capitalizamos la primera letra (frase, no Title Case: "Preparados a base de
    // patata", no "Preparados A Base De Patata"), nunca tocamos acrónimos ajenos
    // (por eso esto NO se aplica a canalLabels, que sí trae "Mercadona LPC" bien tal cual).
    const capitalizarFrase = (s: string) => s.length ? s.charAt(0) + s.slice(1).toLowerCase() : s;
    const familiaLabels = new Map<string, string>();
    (familiaCatalogResult.rows as any[]).forEach((r) => {
      familiaLabels.set(String(r.CODE).trim(), capitalizarFrase(String(r.DESCRIPCION || '').trim()));
    });

    const saborLabels = new Map<string, string>();
    (saborCatalogResult.rows as any[]).forEach((r) => {
      saborLabels.set(String(r.CODE).trim(), capitalizarFrase(String(r.DESCRIPCION || '').trim()));
    });

    const metaMap = new Map<string, { descripcion: string; familia: string; sabor: string }>();
    (metaResult.rows as any[]).forEach((r) => {
      const codigoFamilia = String(r.FAMILIA || '').trim();
      const codigoSabor = String(r.SABOR || '').trim();
      metaMap.set(String(r.ITEM).trim(), {
        descripcion: String(r.DESCRIPCION || '').trim(),
        familia: codigoFamilia ? (familiaLabels.get(codigoFamilia) ?? codigoFamilia) : 'Sin familia',
        sabor: codigoSabor ? (saborLabels.get(codigoSabor) ?? codigoSabor) : SIN_SABOR,
      });
    });

    const canalMap = new Map<string, string | null>();
    const gramajeMap = new Map<string, number | null>();
    (extResult.rows as any[]).forEach((r) => {
      const item = String(r.ITEM).trim();
      const canal = String(r.CANAL || '').trim();
      canalMap.set(item, canal || null);
      const gramos = Number(String(r.GRAMOS_RAW || '').trim());
      gramajeMap.set(item, !Number.isNaN(gramos) && gramos > 0 ? gramos : null);
    });

    const costeMap = new Map<string, number>();
    (costResult.rows as any[]).forEach((r) => {
      const item = String(r.ITEM).trim();
      if (!costeMap.has(item)) costeMap.set(item, (r.COSTE_RAW || 0) / 10000);
    });

    // Acumulador por artículo largo x mes (parseJdeDate ya resuelve el año/mes real).
    const porArticulo = new Map<string, Map<string, { previsto: number; real: number; importeReal: number }>>();
    const getBucketMes = (item: string, sortKey: string) => {
      if (!porArticulo.has(item)) porArticulo.set(item, new Map());
      const meses = porArticulo.get(item)!;
      if (!meses.has(sortKey)) meses.set(sortKey, { previsto: 0, real: 0, importeReal: 0 });
      return meses.get(sortKey)!;
    };
    const getBucket = (item: string, fechaJde: number) => {
      const parsed = parseJdeDate(fechaJde);
      if (!parsed) return null;
      return getBucketMes(item, `${parsed.date.getFullYear()}-${String(parsed.date.getMonth() + 1).padStart(2, '0')}`);
    };
    forecastRows.forEach((r) => {
      const item = String(r.ITEM).trim();
      const b = getBucket(item, r.FECHA_JDE);
      if (b) b.previsto += (r.CANT_PREV_RAW || 0) / 100;
    });
    salesRows.forEach((r) => {
      const item = String(r.ITEM).trim();
      const mes = String(r.MES || '');
      if (!/^[0-9]{6}$/.test(mes)) return;
      const b = getBucketMes(item, `${mes.slice(0, 4)}-${mes.slice(4)}`);
      b.real += (r.CANT_REAL_RAW || 0) / 100;
      b.importeReal += (r.IMPORTE_RAW || 0) / 1000000;
    });

    const saborDe = new Map<string, string>();
    const todos: ArticuloAgg[] = Array.from(porArticulo.entries()).map(([item, mesesMap]) => {
      const corto = shortItemMap.get(item) || '';
      const meta = metaMap.get(corto);
      saborDe.set(item, meta?.sabor ?? SIN_SABOR);
      const meses: MesPunto[] = Array.from(mesesMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sortKey, v]) => ({ sortKey, mes: MES_LABEL[Number(sortKey.split('-')[1]) - 1], ...v }));
      return {
        item,
        descripcion: meta?.descripcion || '',
        familia: meta?.familia || 'Sin familia',
        canal: canalMap.get(corto) ?? null,
        gramaje: gramajeMap.get(corto) ?? null,
        costeUnitario: costeMap.get(item) ?? null,
        meses,
      };
    });

    // Filtro por sabor: tras armar los artículos (el sabor sale de F4101, que ya se lee
    // para la familia), así las opciones del desplegable salen de TODOS los del periodo
    // y no desaparecen al filtrar. La comparación es en memoria: nunca llega a la query.
    const sabores = Array.from(new Set(saborDe.values())).sort((a, b) => a.localeCompare(b));
    const articulos = sabor ? todos.filter((a) => saborDe.get(a.item) === sabor) : todos;

    const resultado = { ...aggregate(articulos, umbralPct, canalLabels), sabores };

    // Registrar consulta en logs (nunca bloquea la respuesta) — mismo source 'compras'
    // que la versión anterior, para que /admin/logs muestre continuidad, no un panel
    // nuevo. result_count = artículos hoja del árbol (equivalente a las filas de la v1).
    try {
      const user = await verifySession().catch(() => null);
      const filters = { startDate: startDateStr, endDate: endDateStr, umbralPct, tipoPrevision: tipoPrev, sabor: sabor || null };
      const resultCount = resultado.familias.reduce(
        (s, f) => s + f.canales.reduce((s2, c) => s2 + c.articulos.length, 0),
        0
      );
      const db = getDb();
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user?.id ?? null, user ? user.username : 'Invitado', 'compras', JSON.stringify(filters), resultCount, Date.now() - startTime);
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({
      mock: false,
      filters: { startDate: startDateStr, endDate: endDateStr, umbralPct, tipoPrevision: tipoPrev, sabor: sabor || null },
      ...resultado,
    });
  } catch (err: any) {
    console.error('Database Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error(e); }
    }
  }
}
