// Panel de Compras (previsión vs. venta real) — rediseño sobre el sistema Nova
// (ShadcnSpace), sustituye a la versión anterior (basada en components/ui/). Ver
// components/nova/README.md (mecanismo de aislamiento data-nova-theme) y
// docs/compras.md (documentación completa del panel).
"use client";

import { useMemo, useState } from "react";
import { RequireAccess, useApiFetch } from "@/components/SessionProvider";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, Filter, Loader2 } from "lucide-react";
import NovaPanelShell from "@/components/nova/panel-shell";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import Charts15 from "@/components/shadcn-space/blocks/chart-15/charts-15";
import DeviationByFamilyChart from "@/components/nova/deviation-by-family-chart";
import HierarchicalTable, { type DrillState, type FamiliaRow, type Unit } from "@/components/nova/hierarchical-table";
import MonthRangePicker, { type MonthRange } from "@/components/nova/month-range-picker";
import NovaPresets, { useNovaPresets } from "@/components/nova/presets";
import type { Aplicacion } from "@/lib/presets-nova";
import { Button } from "@/components/nova/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/nova/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";

// Mes en curso (primer día -> último día) — mismo default que api/compras/route.ts
// cuando se llama sin startDate/endDate.
type TipoPrevision = "PN" | "PM";
const TODOS_SABORES = "__todos__";
// Lo que guarda un preset de /compras (además de las fechas, que van aparte)
type FiltrosCompras = { tipo: TipoPrevision; sabor: string; unit: Unit };
const UNIDADES: Unit[] = ["unidades", "kg", "importe"];

function currentMonthRange(): MonthRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startDate: `${y}-${String(m).padStart(2, "0")}-01`,
    endDate: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}


interface Metric {
  previsto: number;
  real: number;
  desviacionAbs: number;
  desviacionPct: number | null;
}

interface MesPunto {
  sortKey: string;
  mes: string;
  previsto: number;
  real: number;
}

interface ApiResponse {
  mock: boolean;
  familias: FamiliaRow[];
  sabores: string[];
  resumen: {
    unidades: Metric;
    kg: Metric | null;
    importe: Metric | null;
    totalFamilias: number;
    familiasFueraDeUmbral: number;
    umbralPct: number;
    articulosSinGramaje: string[];
    articulosSinCoste: string[];
  };
  mensual: {
    total: MesPunto[];
    totalKg: MesPunto[] | null;
    totalImporte: MesPunto[] | null;
    porFamilia: Record<string, MesPunto[]>;
    porFamiliaCanal: Record<string, MesPunto[]>;
    kgPorFamilia: Record<string, MesPunto[] | null>;
    kgPorFamiliaCanal: Record<string, MesPunto[] | null>;
    importePorFamilia: Record<string, MesPunto[] | null>;
    importePorFamiliaCanal: Record<string, MesPunto[] | null>;
  };
}

// Manual, no Intl: este entorno no tiene datos ICU completos para 'es-ES'
// (toLocaleString('es-ES') se queda sin separador de miles). Ver la misma nota en
// components/nova/hierarchical-table.tsx.
function numeroEs(v: number) {
  const rounded = Math.round(v);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const UNIT_LABEL: Record<Unit, string> = { unidades: "Unidades", kg: "Kg", importe: "Importe" };
function formatNum(v: number, unit: Unit) {
  return unit === "importe" ? `${numeroEs(v)} €` : numeroEs(v);
}
function metricDe(unit: Unit, r: { unidades: Metric; kg: Metric | null; importe: Metric | null }) {
  return unit === "kg" ? r.kg : unit === "importe" ? r.importe : r.unidades;
}

// Formatos numéricos nativos de Excel (mismo patrón que app/compras/page.tsx — 'xlsx'
// no soporta colores/negrita al escribir, solo number format + anchos de columna).
const XLS_FMT_UD = "#,##0";
const XLS_FMT_KG = '#,##0" kg"';
const XLS_FMT_EUR = '#,##0.00" €"';
const XLS_FMT_PCT = "+0.00%;-0.00%";
function setColNumFmt(ws: XLSX.WorkSheet, colIdx: number, rowCount: number, fmt: string, headerRows = 1) {
  for (let r = 0; r < rowCount; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r: r + headerRows, c: colIdx })];
    if (cell && typeof cell.v === "number") cell.z = fmt;
  }
}

function ComprasV2PagePanel() {
  const [drill, setDrill] = useState<DrillState>({ familia: null, canal: null, canalLabel: null });
  const [unit, setUnit] = useState<Unit>("unidades");
  // PN = previsión original, PM = modificada (F3460.MFTYPF). Por defecto la vigente (PM).
  const [tipo, setTipo] = useState<TipoPrevision>("PM");
  // Sabor (F4101.IMSRP5): "" = todos. Las opciones vienen de la API (`sabores`).
  const [sabor, setSabor] = useState("");
  // Por defecto, el mes en curso — el rango se aplica solo al pulsar "Filtrar", no en
  // cada cambio del selector (evita una consulta a Oracle por cada clic).
  const [range, setRange] = useState<MonthRange>(currentMonthRange());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const apiFetch = useApiFetch();


  const fetchData = (r: MonthRange, t: TipoPrevision = tipo, s: string = sabor) => {
    setFetching(true);
    const toastId = toast.loading("Cargando datos de compras…");
    const params = new URLSearchParams();
    params.set("startDate", r.startDate);
    params.set("endDate", r.endDate);
    params.set("tipoPrevision", t);
    if (s) params.set("sabor", s);
    apiFetch(`/api/compras?${params.toString()}`)
      // El 401 lo resuelve useApiFetch (manda al login); el 403 no puede darse
      // dentro de <RequireAccess screen="compras">.
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json) {
          setData(json);
          toast.success("Datos actualizados", { id: toastId });
        } else {
          toast.dismiss(toastId);
        }
      })
      .catch(() => toast.error("No se han podido cargar los datos", { id: toastId }))
      .finally(() => setFetching(false));
  };

  // Presets comunes de Nova. Aplicar uno pone su previsión, sabor y vista (y su rango, si lo trae) y
  // recarga. La primera carga la hace useNovaPresets cuando ya sabe si hay un preset predeterminado, así
  // que no se consulta Oracle dos veces al abrir. Las siguientes cargas las dispara "Filtrar" (el rango
  // no recarga al cambiar el selector de meses).
  const aplicarPreset = (a: Aplicacion<FiltrosCompras>) => {
    const t = a.filtros.tipo === "PN" || a.filtros.tipo === "PM" ? a.filtros.tipo : tipo;
    const s = typeof a.filtros.sabor === "string" ? a.filtros.sabor : sabor;
    const r = a.fechas ?? range;
    setTipo(t);
    setSabor(s);
    if (a.filtros.unit && UNIDADES.includes(a.filtros.unit)) setUnit(a.filtros.unit);
    if (a.fechas) setRange(a.fechas);
    fetchData(r, t, s);
  };
  const presets = useNovaPresets<FiltrosCompras>("compras", (p) => (p ? aplicarPreset(p) : fetchData(range)));
  // El sabor de un preset puede no estar entre los del periodo cargado: se añade para que se vea elegido
  const sabores = data?.sabores ?? [];
  const opcionesSabor = sabor && !sabores.includes(sabor) ? [...sabores, sabor] : sabores;



  const statisticsData = useMemo(() => {
    if (!data) return undefined;
    const m = metricDe(unit, data.resumen);
    if (!m) return [];
    return [
      {
        title: "Previsión",
        value: formatNum(m.previsto, unit),
        subValue: tipo === "PN" ? "Previsión original (PN)" : "Previsión modificada (PM)",
        badgeColor: "bg-muted",
        badgeValue: UNIT_LABEL[unit],
      },
      {
        title: "Ventas reales",
        value: formatNum(m.real, unit),
        subValue: "Facturado en el periodo",
        badgeColor: m.desviacionPct != null && m.desviacionPct >= 0 ? "bg-teal-400/10" : "bg-red-500/10",
        badgeValue: m.desviacionPct != null ? `${m.desviacionPct >= 0 ? "+" : ""}${m.desviacionPct.toFixed(1)}%` : undefined,
      },
      {
        title: "Desviación",
        value: `${m.desviacionAbs >= 0 ? "+" : ""}${formatNum(m.desviacionAbs, unit)}`,
        subValue: "Real – previsión",
        badgeColor: m.desviacionPct != null && m.desviacionPct >= 0 ? "bg-teal-400/10" : "bg-red-500/10",
        badgeValue: m.desviacionPct != null ? `${m.desviacionPct >= 0 ? "+" : ""}${m.desviacionPct.toFixed(1)}%` : undefined,
      },
      {
        title: "Familias fuera de umbral",
        value: `${data.resumen.familiasFueraDeUmbral} / ${data.resumen.totalFamilias}`,
        subValue: `Tolerancia ±${data.resumen.umbralPct}%`,
      },
    ];
  }, [data, unit, tipo]);

  const deviationChartData = useMemo(() => {
    if (!data) return undefined;
    return data.familias.map((f) => ({
      familia: f.familia,
      pct: metricDe(unit, f)?.desviacionPct ?? null,
    }));
  }, [data, unit]);

  // Serie mensual del gráfico "Evolución mensual": misma fuente (mensual.*) que el
  // resto de la pantalla, filtrada al nivel abierto (`drill`) — nunca datos aparte.
  const monthlyChartData = useMemo(() => {
    if (!data) return undefined;
    const claveCanal = drill.familia && drill.canal ? `${drill.familia}::${drill.canal}` : null;
    const porFamiliaCanal = unit === "kg" ? data.mensual.kgPorFamiliaCanal : unit === "importe" ? data.mensual.importePorFamiliaCanal : data.mensual.porFamiliaCanal;
    const porFamilia = unit === "kg" ? data.mensual.kgPorFamilia : unit === "importe" ? data.mensual.importePorFamilia : data.mensual.porFamilia;
    const total = unit === "kg" ? data.mensual.totalKg : unit === "importe" ? data.mensual.totalImporte : data.mensual.total;
    let serie: MesPunto[] | null;
    if (claveCanal) {
      serie = porFamiliaCanal[claveCanal] ?? null;
    } else if (drill.familia) {
      serie = porFamilia[drill.familia] ?? null;
    } else {
      serie = total;
    }
    return (serie ?? []).map((m) => ({ month: m.mes, previsto: m.previsto, real: m.real }));
  }, [data, drill, unit]);

  // Exporta el desglose completo (las 3 unidades, no solo la seleccionada) a un único
  // Excel con 3 hojas — mismo patrón que app/compras/page.tsx (v1).
  const exportToExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    // --- Hoja "Resumen": una fila por familia + total ---
    const resumenRows = data.familias.map((f) => ({
      Familia: f.familia,
      "Ud. Previsión": f.unidades.previsto,
      "Ud. Real": f.unidades.real,
      "Ud. Desv.": f.unidades.desviacionAbs,
      "Ud. Desv. %": f.unidades.desviacionPct != null ? f.unidades.desviacionPct / 100 : "",
      "Kg Previsión": f.kg?.previsto ?? "",
      "Kg Real": f.kg?.real ?? "",
      "Importe Previsión (€)": f.importe?.previsto ?? "",
      "Importe Real (€)": f.importe?.real ?? "",
    }));
    resumenRows.push({
      Familia: "TOTAL",
      "Ud. Previsión": data.resumen.unidades.previsto,
      "Ud. Real": data.resumen.unidades.real,
      "Ud. Desv.": data.resumen.unidades.desviacionAbs,
      "Ud. Desv. %": data.resumen.unidades.desviacionPct != null ? data.resumen.unidades.desviacionPct / 100 : "",
      "Kg Previsión": data.resumen.kg?.previsto ?? "",
      "Kg Real": data.resumen.kg?.real ?? "",
      "Importe Previsión (€)": data.resumen.importe?.previsto ?? "",
      "Importe Real (€)": data.resumen.importe?.real ?? "",
    });
    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    setColNumFmt(wsResumen, 1, resumenRows.length, XLS_FMT_UD);
    setColNumFmt(wsResumen, 2, resumenRows.length, XLS_FMT_UD);
    setColNumFmt(wsResumen, 3, resumenRows.length, XLS_FMT_UD);
    setColNumFmt(wsResumen, 4, resumenRows.length, XLS_FMT_PCT);
    setColNumFmt(wsResumen, 5, resumenRows.length, XLS_FMT_KG);
    setColNumFmt(wsResumen, 6, resumenRows.length, XLS_FMT_KG);
    setColNumFmt(wsResumen, 7, resumenRows.length, XLS_FMT_EUR);
    setColNumFmt(wsResumen, 8, resumenRows.length, XLS_FMT_EUR);
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

    // --- Hoja "Tendencia mensual": total general por mes, las 3 unidades ---
    const kgPorMes = new Map((data.mensual.totalKg ?? []).map((m) => [m.sortKey, m]));
    const importePorMes = new Map((data.mensual.totalImporte ?? []).map((m) => [m.sortKey, m]));
    const tendenciaRows = data.mensual.total.map((m) => ({
      Mes: m.mes,
      "Ud. Previsión": m.previsto,
      "Ud. Real": m.real,
      "Kg Previsión": kgPorMes.get(m.sortKey)?.previsto ?? "",
      "Kg Real": kgPorMes.get(m.sortKey)?.real ?? "",
      "Importe Previsión (€)": importePorMes.get(m.sortKey)?.previsto ?? "",
      "Importe Real (€)": importePorMes.get(m.sortKey)?.real ?? "",
    }));
    const wsTendencia = XLSX.utils.json_to_sheet(tendenciaRows);
    wsTendencia["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    setColNumFmt(wsTendencia, 1, tendenciaRows.length, XLS_FMT_UD);
    setColNumFmt(wsTendencia, 2, tendenciaRows.length, XLS_FMT_UD);
    setColNumFmt(wsTendencia, 3, tendenciaRows.length, XLS_FMT_KG);
    setColNumFmt(wsTendencia, 4, tendenciaRows.length, XLS_FMT_KG);
    setColNumFmt(wsTendencia, 5, tendenciaRows.length, XLS_FMT_EUR);
    setColNumFmt(wsTendencia, 6, tendenciaRows.length, XLS_FMT_EUR);
    XLSX.utils.book_append_sheet(wb, wsTendencia, "Tendencia mensual");

    // --- Hoja "Detalle": familia > canal > artículo aplanado ---
    const detalleRows = data.familias.flatMap((f) =>
      f.canales.flatMap((c) =>
        c.articulos.map((a) => ({
          Familia: f.familia,
          Canal: c.canalLabel,
          Artículo: a.item,
          Descripción: a.descripcion,
          "Ud. Previsión": a.unidades.previsto,
          "Ud. Real": a.unidades.real,
          "Ud. Desv. %": a.unidades.desviacionPct != null ? a.unidades.desviacionPct / 100 : "",
          "Kg Previsión": a.kg?.previsto ?? "",
          "Kg Real": a.kg?.real ?? "",
          "Importe Previsión (€)": a.importe?.previsto ?? "",
          "Importe Real (€)": a.importe?.real ?? "",
        }))
      )
    );
    const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
    wsDetalle["!cols"] = [
      { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
    ];
    const n = detalleRows.length;
    setColNumFmt(wsDetalle, 4, n, XLS_FMT_UD); setColNumFmt(wsDetalle, 5, n, XLS_FMT_UD);
    setColNumFmt(wsDetalle, 6, n, XLS_FMT_PCT);
    setColNumFmt(wsDetalle, 7, n, XLS_FMT_KG); setColNumFmt(wsDetalle, 8, n, XLS_FMT_KG);
    setColNumFmt(wsDetalle, 9, n, XLS_FMT_EUR); setColNumFmt(wsDetalle, 10, n, XLS_FMT_EUR);
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle");

    XLSX.writeFile(wb, `Compras_${tipo}${sabor ? `_${sabor}` : ""}_${range.startDate}_${range.endDate}.xlsx`);
  };

  return (
    <NovaPanelShell title="Compras" grupo="Dashboards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MonthRangePicker value={range} onChange={setRange} />
          {/* Como el tipo de previsión: se aplica al elegir (el servidor lo filtra en memoria) */}
          <Select
            items={[{ value: TODOS_SABORES, label: "Todos los sabores" }, ...opcionesSabor.map((s) => ({ value: s, label: s }))]}
            value={sabor || TODOS_SABORES}
            onValueChange={(v) => {
              const nuevo = v === TODOS_SABORES ? "" : (v as string);
              setSabor(nuevo);
              fetchData(range, tipo, nuevo);
            }}
            disabled={!data || fetching}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              <SelectItem value={TODOS_SABORES}>Todos los sabores</SelectItem>
              {opcionesSabor.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={fetching}>
            {fetching ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            Filtrar
          </Button>
          <NovaPresets
            presets={presets}
            actual={{ filtros: { tipo, sabor, unit }, fechas: range }}
            granularidad="mes"
            onAplicar={aplicarPreset}
            describir={(f) => [f.tipo === "PN" ? "Original (PN)" : f.tipo === "PM" ? "Modificada (PM)" : null, f.sabor || "Todos los sabores", f.unit].filter(Boolean).join(" · ")}
          />
        </div>
        <div className="flex items-center gap-3">
          {/* Cambiar el tipo recarga al instante con el rango del selector */}
          <Tabs value={tipo} onValueChange={(v) => { setTipo(v as TipoPrevision); fetchData(range, v as TipoPrevision); }}>
            <TabsList>
              <TabsTrigger value="PM" disabled={fetching}>Modificada (PM)</TabsTrigger>
              <TabsTrigger value="PN" disabled={fetching}>Original (PN)</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <TabsList>
              <TabsTrigger value="unidades">Unidades</TabsTrigger>
              <TabsTrigger value="kg">Kg</TabsTrigger>
              <TabsTrigger value="importe">Importe</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" className="gap-1.5" onClick={exportToExcel} disabled={!data}>
            <Download size={14} />
            Exportar
          </Button>
        </div>
      </div>

      {!data ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : (
        <>
          {statisticsData && <Statistics data={statisticsData} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Charts15
              className="lg:col-span-2"
              scope={drill.canal ? `${drill.familia} · ${drill.canalLabel ?? drill.canal}` : drill.familia ?? "Todas las familias"}
              unit={UNIT_LABEL[unit]}
              data={monthlyChartData}
            />
            <DeviationByFamilyChart className="lg:col-span-1" unit={UNIT_LABEL[unit]} data={deviationChartData} />
          </div>

          <HierarchicalTable
            familias={data.familias}
            unit={unit}
            drill={drill}
            onDrillChange={setDrill}
            total={{ unidades: data.resumen.unidades, kg: data.resumen.kg, importe: data.resumen.importe }}
          />

          {data.resumen.articulosSinGramaje.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {data.resumen.articulosSinGramaje.length} artículo(s) sin gramaje (F554101) — no entran en los
              totales de Kg: {data.resumen.articulosSinGramaje.join(", ")}
            </p>
          )}
          {data.resumen.articulosSinCoste.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {data.resumen.articulosSinCoste.length} artículo(s) sin coste (F4105) — su importe previsto
              no se puede calcular (queda en 0); su importe real sí se cuenta con normalidad:{" "}
              {data.resumen.articulosSinCoste.join(", ")}
            </p>
          )}
        </>
      )}
    </NovaPanelShell>
  );
}

export default function ComprasV2Page() {
  return (
    <RequireAccess screen="compras">
      <ComprasV2PagePanel />
    </RequireAccess>
  );
}
