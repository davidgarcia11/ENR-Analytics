// Explosión de compras (MRP) — previsión (F3460) + lista de materiales (F3002,
// planta 10999) → cuánto hay que comprar de cada material. Ver /api/mrp y
// ClickUp #869eq7nqd para la lógica completa (explosión recursiva en cascada,
// vigencia del BOM evaluada por mes de previsión, no por "hoy").
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider";
import { toast } from "sonner";
import { Download, Filter, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import MonthRangePicker, { type MonthRange } from "@/components/nova/month-range-picker";
import MrpMaterialsTable, { agregarPorMes, type Material } from "@/components/nova/mrp-materials-table";
import { Button } from "@/components/nova/ui/button";
import { Toaster } from "@/components/nova/ui/sonner";


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

interface MrpResponse {
  materiales: Material[];
  meta: { articulosPrevistos: number; meses: string[] };
}

function MrpPagePanel() {
  const { user: sessionUser, logout } = useSession();
  const apiFetch = useApiFetch();

  const [mode, setMode] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const effectiveTheme = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;



  const [range, setRange] = useState<MonthRange>(currentMonthRange);
  const [data, setData] = useState<MrpResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (r: MonthRange) => {
    setLoading(true);
    const id = toast.loading("Calculando explosión de compras…");
    try {
      const params = new URLSearchParams({ startDate: r.startDate, endDate: r.endDate });
      const res = await apiFetch(`/api/mrp?${params.toString()}`);
      const json: MrpResponse = await res.json();
      setData(json);
      toast.success(`${json.materiales.length} materiales calculados`, { id });
    } catch (err) {
      console.error("Error cargando MRP:", err);
      toast.error("No se ha podido calcular la explosión de compras", { id });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(range); }, []);

  const exportToExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const resumenRows = data.materiales.map((m) => ({
      Codigo: m.codigo, Descripcion: m.descripcion, Familia: m.familia,
      Cantidad: Math.round(m.cantidad * 1000) / 1000, UM: m.um,
    }));
    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 10 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "Compra por material");

    const detalleRows = data.materiales.flatMap((m) =>
      m.contribuciones.map((c) => ({
        Codigo: m.codigo, Material: m.descripcion,
        ArticuloPadre: c.articuloPadre, DescripcionPadre: c.descripcionPadre,
        Mes: c.mes, Cantidad: Math.round(c.cantidad * 1000) / 1000, UM: m.um,
      }))
    );
    const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
    wsDetalle["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle por articulo");

    // Mismo agregado que el árbol en pantalla (por mes, sumando artículos padre) —
    // ver agregarPorMes en mrp-materials-table.tsx, misma función reutilizada.
    const porMesRows = data.materiales.flatMap((m) =>
      agregarPorMes(m.contribuciones).map((mm) => ({
        Codigo: m.codigo, Material: m.descripcion,
        Mes: mm.mes, Cantidad: Math.round(mm.cantidad * 1000) / 1000, UM: m.um,
      }))
    );
    const wsPorMes = XLSX.utils.json_to_sheet(porMesRows);
    wsPorMes["!cols"] = [{ wch: 14 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsPorMes, "Desglose por mes");

    XLSX.writeFile(wb, `MRP_${range.startDate}_${range.endDate}.xlsx`);
  };

  const portalContainerRef = useRef<HTMLDivElement>(null);

  const stats = data
    ? [
        { title: "Artículos con previsión", value: data.meta.articulosPrevistos.toLocaleString("es-ES"), subValue: "En el rango seleccionado" },
        { title: "Materiales a comprar", value: data.materiales.length.toLocaleString("es-ES"), subValue: "Distintos, tras la explosión" },
        { title: "Meses cubiertos", value: String(data.meta.meses.length), subValue: data.meta.meses.join(", ") || "—" },
      ]
    : [];

  return (
    <div data-nova-theme={effectiveTheme} ref={portalContainerRef} className="min-h-screen bg-sidebar text-foreground">
      <NovaPortalProvider container={portalContainerRef}>
        <div className="md:m-2 md:rounded-xl md:outline md:outline-border md:shadow-sm md:overflow-hidden bg-background">
          <Header user={sessionUser} onLogout={logout} mode={mode} onModeChange={setMode} />
          <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <MonthRangePicker value={range} onChange={setRange} />
                <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
                  Filtrar
                </Button>
              </div>
              <Button size="sm" className="gap-1.5" onClick={exportToExcel} disabled={!data || data.materiales.length === 0}>
                <Download size={14} />
                Exportar
              </Button>
            </div>

            {!data ? (
              <p className="text-muted-foreground">Cargando…</p>
            ) : (
              <>
                <Statistics data={stats} columns={3} />
                <MrpMaterialsTable data={data.materiales} />
              </>
            )}
          </main>
        </div>
        <Toaster />
      </NovaPortalProvider>
    </div>
  );
}

export default function MrpPage() {
  return (
    <RequireAccess screen="mrp">
      <MrpPagePanel />
    </RequireAccess>
  );
}
