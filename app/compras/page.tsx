// Panel de Compras (previsión vs. venta real) — rediseño sobre el sistema Nova
// (ShadcnSpace), sustituye a la versión anterior (basada en components/ui/). Ver
// components/nova/README.md (mecanismo de aislamiento data-nova-theme) y
// docs/compras.md (documentación completa del panel).
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import Charts15 from "@/components/shadcn-space/blocks/chart-15/charts-15";
import DeviationByFamilyChart from "@/components/nova/deviation-by-family-chart";
import HierarchicalTable, { type DrillState, type FamiliaRow, type Unit } from "@/components/nova/hierarchical-table";
import MonthRangePicker, { type MonthRange } from "@/components/nova/month-range-picker";
import { Button } from "@/components/nova/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/nova/ui/tabs";

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

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

export default function ComprasV2Page() {
  const router = useRouter();
  const [drill, setDrill] = useState<DrillState>({ familia: null, canal: null, canalLabel: null });
  const [unit, setUnit] = useState<Unit>("unidades");
  // Campaña por defecto (sep-ago) — filtra Oracle vía startDate/endDate.
  const [range, setRange] = useState<MonthRange>({ startDate: "2025-09-01", endDate: "2026-08-31" });
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("startDate", range.startDate);
    params.set("endDate", range.endDate);
    fetch(`/api/compras?${params.toString()}`)
      .then((r) => {
        // Sin sesión (o sin permiso) requireScreenAccess('compras') devuelve 401/403
        // con { error }, no la forma de ApiResponse — si se intenta pintar igualmente
        // (data.resumen/data.familias undefined) la página revienta en vez de redirigir.
        if (r.status === 401 || r.status === 403) {
          router.push("/login");
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (json) setData(json);
      })
      .finally(() => setLoading(false));
  }, [range, router]);

  // Mismo patrón que el resto de paneles (ver app/caducados/page.tsx) — solo para
  // mostrar quién ha entrado y poder cerrar sesión desde la cabecera. El control de
  // acceso real ya lo hace requireScreenAccess('compras') en api/compras/route.ts.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSessionUser)
      .catch(() => setSessionUser(null));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
  };

  const statisticsData = useMemo(() => {
    if (!data) return undefined;
    const m = metricDe(unit, data.resumen);
    if (!m) return [];
    return [
      {
        title: "Previsión",
        value: formatNum(m.previsto, unit),
        subValue: "Plan comercial aprobado",
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
  }, [data, unit]);

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

    XLSX.writeFile(wb, `Compras_${range.startDate}_${range.endDate}.xlsx`);
  };

  return (
    <div data-nova-theme="light" className="min-h-screen bg-sidebar text-foreground">
      <div className="md:m-2 md:rounded-xl md:outline md:outline-border md:shadow-sm md:overflow-hidden bg-background">
        <Header user={sessionUser} onLogout={logout} />
        <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MonthRangePicker value={range} onChange={setRange} />
            <div className="flex items-center gap-3">
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

          {loading || !data ? (
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
        </main>
      </div>
    </div>
  );
}
