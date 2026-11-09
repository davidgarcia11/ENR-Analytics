// Explosión de compras (MRP) — previsión (F3460) + lista de materiales (F3002,
// planta 10999) → cuánto hay que comprar de cada material. Ver /api/mrp y
// ClickUp #869eq7nqd para la lógica completa (explosión recursiva en cascada,
// vigencia del BOM evaluada por mes de previsión, no por "hoy").
"use client";

import { useCallback, useState } from "react";
import { RequireAccess, useApiFetch } from "@/components/SessionProvider";
import { toast } from "sonner";
import { Download, Filter, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import NovaPanelShell from "@/components/nova/panel-shell";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import MonthRangePicker, { type MonthRange } from "@/components/nova/month-range-picker";
import NovaPresets, { useNovaPresets } from "@/components/nova/presets";
import type { Aplicacion } from "@/lib/presets-nova";
import MrpMaterialsTable, { agregarPorMes, type Material } from "@/components/nova/mrp-materials-table";
import { Button } from "@/components/nova/ui/button";


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
  const apiFetch = useApiFetch();




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

  // Presets comunes de Nova (aquí solo guardan el periodo). La primera carga la hace useNovaPresets cuando
  // ya sabe si hay un preset predeterminado, para no calcular la explosión dos veces al abrir.
  const aplicarPreset = (a: Aplicacion<Record<string, never>>) => {
    if (!a.fechas) return;
    setRange(a.fechas);
    fetchData(a.fechas);
  };
  const presets = useNovaPresets<Record<string, never>>("mrp", (p) => (p?.fechas ? aplicarPreset(p) : fetchData(range)));

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


  const stats = data
    ? [
        { title: "Artículos con previsión", value: data.meta.articulosPrevistos.toLocaleString("es-ES"), subValue: "En el rango seleccionado" },
        { title: "Materiales a comprar", value: data.materiales.length.toLocaleString("es-ES"), subValue: "Distintos, tras la explosión" },
        { title: "Meses cubiertos", value: String(data.meta.meses.length), subValue: data.meta.meses.join(", ") || "—" },
      ]
    : [];

  return (
    <NovaPanelShell title="Explosión de compras" grupo="Dashboards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <MonthRangePicker value={range} onChange={setRange} />
          <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            Filtrar
          </Button>
          <NovaPresets presets={presets} actual={{ filtros: {}, fechas: range }} granularidad="mes" onAplicar={aplicarPreset} />
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
    </NovaPanelShell>
  );
}

export default function MrpPage() {
  return (
    <RequireAccess screen="mrp">
      <MrpPagePanel />
    </RequireAccess>
  );
}
