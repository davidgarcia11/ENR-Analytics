// Nivel de servicio (OTIF) de pedidos: a tiempo, completo y OTIF por envío/pedido.
// Dashboard sobre Nova/ShadcnSpace con una capa de datos manuales. Ver docs/servicio.md.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { RequireAccess, useApiFetch } from "@/components/SessionProvider";
import { toast } from "sonner";
import { Download, Filter, Loader2, Tags } from "lucide-react";
import NovaPanelShell from "@/components/nova/panel-shell";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import ServicioIndicadores from "@/components/nova/servicio-indicadores";
import ServicioTable, { type CatalogosServicio, type EnvioDto, type PatchEnvio, ENTREGA_LABEL } from "@/components/nova/servicio-table";
import DateRangePicker, { type DateRange } from "@/components/nova/date-range-picker";
import ServicioClientesFiltro, { type OpcionCliente, type OpcionFiltro, type TextosFiltro } from "@/components/nova/servicio-clientes-filtro";
import NovaPresets, { useNovaPresets } from "@/components/nova/presets";
import { BotonCompartir, Compartible, CompartirProvider } from "@/components/nova/compartir";
import { describirRango, type Aplicacion } from "@/lib/presets-nova";
import { Button } from "@/components/nova/ui/button";
import { OBJETIVO_OTIF_PCT, TIPOS_PEDIDO, calcularKpis, estadoEntrega, filtrarPorClientes, filtrarPorTipos, resumirPedidos } from "@/lib/servicio";

const iso = (d: Date) => d.toISOString().slice(0, 10);
// `excluir` es el modo «todos menos» de los clientes (nombre de antes de existir el filtro de tipos: los
// filtros ya guardados lo usan así)
type FiltrosServicio = { clientes: number[]; excluir: boolean; tipos: string[]; excluirTipos: boolean };
// Tipos de pedido (SDDCTO): siempre los cuatro, aunque en el rango no haya de alguno
const OPCIONES_TIPOS: OpcionFiltro<string>[] = Object.entries(TIPOS_PEDIDO).map(([id, nombre]) => ({ id, nombre: `${nombre} (${id})` }));
const TEXTOS_TIPOS: TextosFiltro = { todos: "Todos los tipos", plural: "tipos", buscar: "Buscar tipo…", vacio: "Sin tipos", quitar: "Quitar el filtro de tipos de pedido" };
// Filtro de clientes o tipos para el pie de la imagen compartida: con nombres si son 3 o menos
const filtroParaImagen = <K,>(valores: K[], excluir: boolean, nombre: (k: K) => string, todos: string, plural: string) => {
  if (valores.length === 0) return todos;
  const lista = valores.length <= 3 ? valores.map(nombre).join(", ") : `${valores.length} ${plural}`;
  return excluir ? `Todos menos ${lista}` : `${plural.charAt(0).toUpperCase()}${plural.slice(1)}: ${lista}`;
};
const describirLista = (n: number, excluir: boolean, singular: string, plural: string) =>
  `${excluir ? "todos menos " : ""}${n} ${n === 1 ? singular : plural}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`);

function ServicioPagePanel() {
  const apiFetch = useApiFetch();

  // Rango sobre la fecha de entrega prometida. Por defecto, últimos 30 días.
  const [range, setRange] = useState<DateRange | null>({ startDate: iso(new Date(Date.now() - 30 * 86400000)), endDate: iso(new Date()) });
  const [envios, setEnvios] = useState<EnvioDto[] | null>(null);
  // Rango de los datos cargados, para el pie de las imágenes compartidas (el del selector puede haberse
  // cambiado sin pulsar «Filtrar»)
  const [rangoCargado, setRangoCargado] = useState<DateRange | null>(null);
  const pagina = useRef<HTMLDivElement>(null);
  // Clientes elegidos (SDAN8); vacío = todos. Con `excluirClientes`, son los quitados («todos menos»).
  // Filtra en pantalla los envíos ya cargados.
  const [clientes, setClientes] = useState<number[]>([]);
  const [excluirClientes, setExcluirClientes] = useState(false);
  // Tipos de pedido elegidos (SDDCTO: venta, EDI, muestras); mismas reglas que los clientes
  const [tipos, setTipos] = useState<string[]>([]);
  const [excluirTipos, setExcluirTipos] = useState(false);
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
      setRangoCargado(r);
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
    setTipos(Array.isArray(a.filtros.tipos) ? a.filtros.tipos.filter((t) => t in TIPOS_PEDIDO) : []);
    setExcluirTipos(a.filtros.excluirTipos === true);
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
    envios?.forEach((e) => { if (!porId.has(e.cliente)) porId.set(e.cliente, e.clienteNombre || `Cliente ${e.cliente}`); });
    return Array.from(porId, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
  }, [envios]);
  const visibles = useMemo(
    () => (envios ? filtrarPorTipos(filtrarPorClientes(envios, clientes, excluirClientes), tipos, excluirTipos) : null),
    [envios, clientes, excluirClientes, tipos, excluirTipos]
  );

  const kpis = useMemo(() => (visibles ? calcularKpis(resumirPedidos(visibles), iso(new Date())) : null), [visibles]);

  const exportar = () => {
    if (!visibles) return;
    const filas = visibles.map((e) => ({
      Pedido: e.pedido, "Tipo pedido": e.tipoPedido, "Su pedido": e.suPedido, Cliente: e.clienteNombre, Destino: e.destinoNombre, Canal: e.canalLabel ?? "",
      Albarán: e.albaran || "", "Fecha envío": e.fechaEnvio ?? "",
      "Fecha prometida": e.fechaPrometida ?? "", "Fecha entrega real": e.fechaEntregaReal ?? "", "Uds enviadas": e.udsEnviadas,
      "Uds pedidas (envío)": e.udsPedidas, "Cajas enviadas": Math.round(e.cajasEnviadas * 10) / 10, "Cajas pedidas (envío)": Math.round(e.cajasPedidas * 10) / 10, Transportista: e.transportista, Estado: e.duplicadoDe ? "Duplicado" : ENTREGA_LABEL[e.entrega], "Duplicado de": e.duplicadoDe ?? "",
      Responsable: e.responsable, Motivo: e.motivo, Incidencia: e.incidencia, "Uds afectadas": e.udsAfectadas, "Cajas afectadas": e.cajasAfectadas,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), "Envíos");
    // Desglose de las afectadas por artículo (solo los envíos que lo tienen)
    const porArticulo = visibles.flatMap((e) => e.afectadasArticulos.map((a) => ({
      Pedido: e.pedido, Albarán: e.albaran || "", Cliente: e.clienteNombre, Artículo: a.articulo,
      Descripción: e.articulos.find((x) => x.articulo === a.articulo)?.descripcion ?? "",
      "Uds afectadas": a.uds, "Cajas afectadas": a.cajas, Motivo: e.motivo, Responsable: e.responsable,
    })));
    if (porArticulo.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porArticulo), "Incidencias por artículo");
    XLSX.writeFile(wb, `nivel-servicio_${range?.startDate ?? "todo"}_${range?.endDate ?? ""}.xlsx`);
  };


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
        kpi("% OTIF", kpis.pctOtif, `${kpis.pedidos} pedidos evaluados${kpis.duplicados ? ` · ${kpis.duplicados} duplicado${kpis.duplicados === 1 ? "" : "s"} fuera` : ""}`),
        kpi("% A tiempo", kpis.pctATiempo, `${kpis.aTiempo} de ${kpis.pedidos} pedidos`),
        kpi("% Completo", kpis.pctCompleto, `${kpis.udsEnviadas.toLocaleString("es-ES")} de ${kpis.udsPedidas.toLocaleString("es-ES")} uds`),
      ]
    : [];

  // Pie de las imágenes compartidas: rango, clientes, tipos de pedido y si son datos de ejemplo
  const infoCompartir = {
    panel: "Nivel de servicio",
    seccion: vista === "seguimiento" ? "Seguimiento" : "Indicadores",
    filtros: [
      [
        rangoCargado ? `Entrega prometida ${describirRango(rangoCargado)}` : "",
        filtroParaImagen(clientes, excluirClientes, (id) => opcionesClientes.find((o) => o.id === id)?.nombre ?? `Cliente ${id}`, "Todos los clientes", "clientes"),
        filtroParaImagen(tipos, excluirTipos, (t) => OPCIONES_TIPOS.find((o) => o.id === t)?.nombre ?? t, "Todos los tipos de pedido", "tipos"),
        esMock ? "Datos de ejemplo" : "",
      ].filter(Boolean).join(" · "),
    ],
  };

  return (
    <CompartirProvider valor={infoCompartir}>
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
          <ServicioClientesFiltro<string>
            opciones={OPCIONES_TIPOS}
            value={tipos}
            excluir={excluirTipos}
            onChange={(t, ex) => { setTipos(t); setExcluirTipos(ex); }}
            textos={TEXTOS_TIPOS}
            icono={Tags}
            buscador={false}
          />
          <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            Filtrar
          </Button>
          <NovaPresets
            presets={presets}
            actual={{ filtros: { clientes, excluir: excluirClientes, tipos, excluirTipos }, fechas: range }}
            granularidad="dia"
            onAplicar={aplicarPreset}
            describir={(f) => {
              const nc = f.clientes?.length ?? 0;
              const nt = f.tipos?.length ?? 0;
              const partes = [
                nc ? describirLista(nc, f.excluir === true, "cliente", "clientes") : "",
                nt ? describirLista(nt, f.excluirTipos === true, "tipo", "tipos") : "",
              ].filter(Boolean).join(" · ");
              return partes ? partes.charAt(0).toUpperCase() + partes.slice(1) : "Todos los clientes y tipos";
            }}
          />
          <span className="text-xs text-muted-foreground">Por fecha de entrega prometida</span>
          {esMock && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">Datos de ejemplo</span>}
        </div>
        <div className="flex items-center gap-2">
          {envios && <BotonCompartir objetivo={pagina} titulo={vista === "seguimiento" ? "Seguimiento de envíos" : "Indicadores"} conTexto />}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={exportar} disabled={!visibles?.length}>
            <Download size={14} /> Exportar
          </Button>
        </div>
      </div>

      {!envios ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : (
        // La página completa (botón «Compartir» de la barra) es esta sección; cada bloque tiene además el suyo
        <div ref={pagina} className="flex flex-col gap-4">
          {vista === "seguimiento" ? (
            <>
              <Compartible titulo="Indicadores clave">{(boton) => (
                <Statistics data={stats} columns={3} accion={boton} />
              )}</Compartible>
              <Compartible titulo="Envíos">{(boton) => (
                <ServicioTable data={visibles ?? []} catalogos={catalogos} onSave={handleSave} accion={boton} />
              )}</Compartible>
            </>
          ) : (
            <ServicioIndicadores envios={visibles ?? []} />
          )}
        </div>
      )}
    </NovaPanelShell>
    </CompartirProvider>
  );
}

export default function ServicioPage() {
  return (
    <RequireAccess screen="servicio">
      <ServicioPagePanel />
    </RequireAccess>
  );
}
