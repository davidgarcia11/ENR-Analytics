// Nivel de servicio (OTIF) de pedidos: a tiempo, completo y OTIF por envío/pedido.
// Dashboard sobre Nova/ShadcnSpace con una capa de datos manuales. Ver docs/servicio.md.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { RequireAccess, useApiFetch } from "@/components/SessionProvider";
import { toast } from "sonner";
import { Download, Filter, Loader2 } from "lucide-react";
import NovaPanelShell from "@/components/nova/panel-shell";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import ServicioIndicadores from "@/components/nova/servicio-indicadores";
import ServicioTable, { type CatalogosServicio, type EnvioDto, type PatchEnvio, ENTREGA_LABEL } from "@/components/nova/servicio-table";
import DateRangePicker, { type DateRange } from "@/components/nova/date-range-picker";
import ServicioClientesFiltro, { type OpcionCliente } from "@/components/nova/servicio-clientes-filtro";
import NovaPresets, { useNovaPresets } from "@/components/nova/presets";
import type { Aplicacion } from "@/lib/presets-nova";
import { Button } from "@/components/nova/ui/button";
import { OBJETIVO_OTIF_PCT, calcularKpis, estadoEntrega, filtrarPorClientes, resumirPedidos } from "@/lib/servicio";

const iso = (d: Date) => d.toISOString().slice(0, 10);
type FiltrosServicio = { clientes: number[]; excluir: boolean };
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`);

function ServicioPagePanel() {
  const apiFetch = useApiFetch();

  // Rango sobre la fecha de entrega prometida. Por defecto, últimos 30 días.
  const [range, setRange] = useState<DateRange | null>({ startDate: iso(new Date(Date.now() - 30 * 86400000)), endDate: iso(new Date()) });
  const [envios, setEnvios] = useState<EnvioDto[] | null>(null);
  // Clientes elegidos (SDAN8); vacío = todos. Con `excluirClientes`, son los quitados («todos menos»).
  // Filtra en pantalla los envíos ya cargados.
  const [clientes, setClientes] = useState<number[]>([]);
  const [excluirClientes, setExcluirClientes] = useState(false);
  const [loading, setLoading] = useState(false);
  // Opciones de los desplegables (motivos, responsables, transportistas): se editan en /admin → Listas de servicio
  const [catalogos, setCatalogos] = useState<CatalogosServicio>({ motivos: [], responsables: [], transportistas: [] });
  const [vista, setVista] = useState<"seguimiento" | "indicadores">("seguimiento");
  // /servicio?mock=1: entregas ficticias de ene–jul 2024 (sin Oracle ni SQLite). Los cambios
  // del lápiz solo quedan en pantalla. Se lee en el efecto de montaje para no desajustar la hidratación.
  const mockRef = useRef(false);
  const [esMock, setEsMock] = useState(false);
  // Los presets dependen del modo (en ?mock=1 van a otro panel): no se cargan hasta haber leído la URL
  const [modoListo, setModoListo] = useState(false);

  const fetchData = useCallback(async (r: DateRange | null) => {
    setLoading(true);
    const id = toast.loading("Consultando pedidos…");
    try {
      const params = new URLSearchParams(r ? { startDate: r.startDate, endDate: r.endDate } : {});
      if (mockRef.current) params.set("mock", "1");
      const res = await apiFetch(`/api/servicio?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setEnvios(json.envios);
      toast.success(`${json.envios.length} envíos encontrados`, { id });
    } catch (err) {
      console.error("Error cargando nivel de servicio:", err);
      toast.error("No se ha podido cargar el nivel de servicio", { id });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  // La sección vive en la URL (?seccion=) para poder llegar a Indicadores desde el submenú de otro panel
  // y para que recargar no devuelva a Seguimiento. Se lee en el efecto de montaje (no al crear el
  // estado) para no desajustar la hidratación.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("seccion");
    if (s === "seguimiento" || s === "indicadores") setVista(s);
  }, []);
  const cambiarVista = (key: string) => {
    if (key !== "seguimiento" && key !== "indicadores") return;
    setVista(key);
    const p = new URLSearchParams(window.location.search);
    p.set("seccion", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
  };

  useEffect(() => {
    apiFetch("/api/servicio/catalogos").then((r) => (r.ok ? r.json() : null)).then((c) => c && setCatalogos(c)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Solo lee el modo; la primera consulta la hace useNovaPresets cuando sabe si hay preset predeterminado
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mock") === "1") {
      mockRef.current = true;
      setEsMock(true);
      setRange({ startDate: "2024-01-01", endDate: "2024-07-31" });
    }
    setModoListo(true);
  }, []);

  // Presets comunes de Nova. En ?mock=1 van a 'servicio-ejemplo' para no mezclar clientes inventados con
  // los reales. Aplicar uno pone sus clientes y, si trae fechas, consulta ese rango.
  const aplicarPreset = (a: Aplicacion<FiltrosServicio>) => {
    setClientes(Array.isArray(a.filtros.clientes) ? a.filtros.clientes.filter(Number.isInteger) : []);
    setExcluirClientes(a.filtros.excluir === true);
    if (a.fechas) { setRange(a.fechas); fetchData(a.fechas); }
  };
  const presets = useNovaPresets<FiltrosServicio>(modoListo ? (esMock ? "servicio-ejemplo" : "servicio") : null, (p) => {
    if (p) aplicarPreset(p);
    if (!p?.fechas) fetchData(range);
  });

  // Guarda en el servidor y, si va bien, refleja el cambio en pantalla recalculando el
  // estado de entrega y los KPIs en cliente (lib/servicio.ts es lógica pura).
  const handleSave = useCallback(async (e: EnvioDto, patch: PatchEnvio) => {
    if (!mockRef.current) try {
      const res = await apiFetch("/api/servicio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido: e.pedido, albaran: e.albaran, ...patch }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("No se ha podido guardar el cambio");
      throw new Error("guardar");
    }
    setEnvios((prev) => prev && prev.map((x) => {
      if (x.pedido !== e.pedido || x.albaran !== e.albaran) return x;
      const n = { ...x, ...patch, fechaEntregaReal: patch.fechaEntregaReal !== undefined ? patch.fechaEntregaReal : x.fechaEntregaReal };
      return { ...n, entrega: estadoEntrega(n, n.fechaEntregaReal) };
    }));
    toast.success(mockRef.current ? `Pedido ${e.pedido} (ejemplo, solo en pantalla)` : `Pedido ${e.pedido} guardado`);
  }, [apiFetch]);

  const opcionesClientes = useMemo<OpcionCliente[]>(() => {
    const porId = new Map<number, string>();
    envios?.forEach((e) => { if (!porId.has(e.cliente)) porId.set(e.cliente, e.clienteNombre); });
    return Array.from(porId, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  }, [envios]);
  const visibles = useMemo(() => (envios ? filtrarPorClientes(envios, clientes, excluirClientes) : null), [envios, clientes, excluirClientes]);

  const kpis = useMemo(() => (visibles ? calcularKpis(resumirPedidos(visibles), iso(new Date())) : null), [visibles]);

  const exportar = () => {
    if (!visibles) return;
    const filas = visibles.map((e) => ({
      Pedido: e.pedido, "Su pedido": e.suPedido, Cliente: e.clienteNombre, Destino: e.destinoNombre, Canal: e.canalLabel ?? "",
      Albarán: e.albaran || "", "Fecha envío": e.fechaEnvio ?? "",
      "Fecha prometida": e.fechaPrometida ?? "", "Fecha entrega real": e.fechaEntregaReal ?? "", "Uds enviadas": e.udsEnviadas,
      "Uds pedidas (envío)": e.udsPedidas, "Cajas enviadas": Math.round(e.cajasEnviadas * 10) / 10, "Cajas pedidas (envío)": Math.round(e.cajasPedidas * 10) / 10, Transportista: e.transportista, Estado: ENTREGA_LABEL[e.entrega],
      Responsable: e.responsable, Motivo: e.motivo, Incidencia: e.incidencia, "Uds afectadas": e.udsAfectadas, "Cajas afectadas": e.cajasAfectadas,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Envíos");
    XLSX.writeFile(wb, `nivel-servicio_${range?.startDate ?? "todo"}_${range?.endDate ?? ""}.xlsx`);
  };

  // Envíos ya enviados a los que aún falta la fecha de entrega real: lo que hay que rellenar para que
  // el % a tiempo y el OTIF digan algo (por eso van en una tarjeta propia).
  const pendientes = visibles ? visibles.filter((e) => e.entrega === "sin_confirmar").length : 0;
  const coberturaBaja = kpis?.cobertura != null && kpis.cobertura < 80;

  // Color de los KPI frente al objetivo: verde si lo cumple, ámbar hasta 8 puntos por debajo, rojo por debajo
  const colorKpi = (v: number | null) => {
    if (v === null) return { texto: undefined, badge: undefined };
    if (v >= OBJETIVO_OTIF_PCT) return { texto: "text-teal-500", badge: "bg-teal-400/10 text-teal-500" };
    if (v >= OBJETIVO_OTIF_PCT - 8) return { texto: "text-amber-500", badge: "bg-amber-400/10 text-amber-500" };
    return { texto: "text-red-500", badge: "bg-red-500/10 text-red-500" };
  };
  const frenteAObjetivo = (v: number | null) => (v === null ? undefined : `${v - OBJETIVO_OTIF_PCT >= 0 ? "+" : "−"}${Math.abs(v - OBJETIVO_OTIF_PCT).toLocaleString("es-ES", { maximumFractionDigits: 1 })} pp`);
  const kpi = (titulo: string, v: number | null, subValue: string, aviso?: string) => {
    const c = colorKpi(v);
    return { title: titulo, value: pct(v), subValue, valueClassName: c.texto, badgeValue: aviso ?? frenteAObjetivo(v), badgeColor: aviso ? "bg-amber-400/10 text-amber-500" : c.badge };
  };

  const stats = kpis
    ? [
        kpi("% OTIF", kpis.pctOtif, `${kpis.pedidos} pedidos evaluados · cobertura ${pct(kpis.cobertura)}`, coberturaBaja ? "Cobertura baja" : undefined),
        kpi("% A tiempo", kpis.pctATiempo, `${kpis.confirmados} de ${kpis.pedidos} con entrega confirmada`),
        kpi("% Completo", kpis.pctCompleto, `${kpis.udsEnviadas.toLocaleString("es-ES")} de ${kpis.udsPedidas.toLocaleString("es-ES")} uds`),
        { title: "Pendientes de confirmar", value: String(pendientes), subValue: "Envíos sin fecha de entrega real", valueClassName: pendientes > 0 ? "text-amber-500" : "text-teal-500", badgeValue: pendientes > 0 ? "Por rellenar" : "Al día", badgeColor: pendientes > 0 ? "bg-amber-400/10 text-amber-500" : "bg-teal-400/10 text-teal-500" },
      ]
    : [];

  return (
    <NovaPanelShell
      title="Nivel de servicio"
      grupo="Dashboards"
      seccionActiva={vista}
      onSeccion={cambiarVista}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <ServicioClientesFiltro
            opciones={opcionesClientes}
            value={clientes}
            excluir={excluirClientes}
            onChange={(c, ex) => { setClientes(c); setExcluirClientes(ex); }}
          />
          <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            Filtrar
          </Button>
          <NovaPresets
            presets={presets}
            actual={{ filtros: { clientes, excluir: excluirClientes }, fechas: range }}
            granularidad="dia"
            onAplicar={aplicarPreset}
            describir={(f) => {
              const n = f.clientes?.length ?? 0;
              if (!n) return "Todos los clientes";
              return f.excluir ? `Todos menos ${n} cliente${n === 1 ? "" : "s"}` : `${n} cliente${n === 1 ? "" : "s"}`;
            }}
          />
          <span className="text-xs text-muted-foreground">Por fecha de entrega prometida</span>
          {esMock && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">Datos de ejemplo</span>}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={exportar} disabled={!visibles?.length}>
          <Download size={14} /> Exportar
        </Button>
      </div>

      {!envios ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : vista === "seguimiento" ? (
        <>
          <Statistics data={stats} columns={4} />
          <ServicioTable data={visibles ?? []} catalogos={catalogos} onSave={handleSave} />
        </>
      ) : (
        <ServicioIndicadores envios={visibles ?? []} />
      )}
    </NovaPanelShell>
  );
}

export default function ServicioPage() {
  return (
    <RequireAccess screen="servicio">
      <ServicioPagePanel />
    </RequireAccess>
  );
}
