// Control de muestras de producto terminado — pendiente / enviado / completado.
// Primera App (no Dashboard) construida sobre Nova/ShadcnSpace. Ver ClickUp #869etmf6d
// y docs/muestras.md.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso } from "@/lib/permisos";
import { toast } from "sonner";
import { Filter, Loader2 } from "lucide-react";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import MuestrasTable, { type Muestra, type Estado, ESTADO_LABEL, ESTADO_TEXT_COLOR } from "@/components/nova/muestras-table";
import MuestrasArticleConfig from "@/components/nova/muestras-article-config";
import DateRangePicker, { type DateRange } from "@/components/nova/date-range-picker";
import { Button } from "@/components/nova/ui/button";
import { Toaster } from "@/components/nova/ui/sonner";

interface MuestrasResponse {
  muestras: Muestra[];
  resumen: { total: number; pendientes: number; enviados: number; completados: number };
  sinConfigurar?: boolean;
}

function MuestrasPagePanel() {
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



  // null = sin filtro de fechas (todo el histórico) — por defecto, para no esconder
  // pendientes antiguos. Ver comentario en date-range-picker.tsx.
  const [range, setRange] = useState<DateRange | null>(null);
  const [data, setData] = useState<MuestrasResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (r: DateRange | null) => {
    setLoading(true);
    const id = toast.loading("Consultando muestras…");
    try {
      const params = r ? new URLSearchParams({ startDate: r.startDate, endDate: r.endDate }) : null;
      const res = await apiFetch(`/api/muestras${params ? `?${params.toString()}` : ""}`);
      const json: MuestrasResponse = await res.json();
      setData(json);
      toast.success(`${json.muestras.length} lotes encontrados`, { id });
    } catch (err) {
      console.error("Error cargando muestras:", err);
      toast.error("No se han podido cargar las muestras", { id });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(null); }, []);

  const recalcularResumen = (muestras: Muestra[]) => ({
    total: muestras.length,
    pendientes: muestras.filter((m) => m.estado === "pendiente").length,
    enviados: muestras.filter((m) => m.estado === "enviado").length,
    completados: muestras.filter((m) => m.estado === "completado").length,
  });

  // Actualización optimista: refleja el cambio en pantalla al instante y confirma
  // contra la API en segundo plano; si falla, revierte y avisa con un toast.
  const handleUpdate = useCallback((articulo: string, lote: string, patch: { estado?: Estado; observacion?: string }) => {
    setData((prev) => {
      if (!prev) return prev;
      const muestras = prev.muestras.map((m) => (m.articulo === articulo && m.lote === lote ? { ...m, ...patch } : m));
      return { muestras, resumen: recalcularResumen(muestras) };
    });

    apiFetch("/api/muestras", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articulo, lote, ...patch }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        if (patch.estado) toast.success(`${articulo} · ${lote} → ${ESTADO_LABEL[patch.estado]}`);
      })
      .catch(() => {
        toast.error("No se ha podido guardar el cambio");
        fetchData(range);
      });
  }, [fetchData, range]);

  // Cambio de estado de varios lotes a la vez (selección múltiple en la tabla) — una
  // sola petición al servidor (transacción), no N peticiones sueltas.
  const handleBulkUpdate = useCallback(async (items: { articulo: string; lote: string }[], estado: Estado) => {
    const claves = new Set(items.map((i) => `${i.articulo}::${i.lote}`));
    setData((prev) => {
      if (!prev) return prev;
      const muestras = prev.muestras.map((m) => (claves.has(`${m.articulo}::${m.lote}`) ? { ...m, estado } : m));
      return { muestras, resumen: recalcularResumen(muestras) };
    });

    try {
      const res = await apiFetch("/api/muestras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, estado }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${items.length} lote${items.length === 1 ? "" : "s"} → ${ESTADO_LABEL[estado]}`);
    } catch {
      toast.error("No se ha podido aplicar el cambio masivo");
      fetchData(range);
    }
  }, [fetchData, range]);

  const portalContainerRef = useRef<HTMLDivElement>(null);
  const puedeConfigurar = tienePermiso(sessionUser, "muestras.config");

  const stats = data
    ? [
        { title: "Pendientes", value: String(data.resumen.pendientes), subValue: "Sin enviar todavía", valueClassName: ESTADO_TEXT_COLOR.pendiente },
        { title: "Enviados", value: String(data.resumen.enviados), subValue: "En laboratorio", valueClassName: ESTADO_TEXT_COLOR.enviado },
        { title: "Completados", value: String(data.resumen.completados), subValue: "Resultado recibido", valueClassName: ESTADO_TEXT_COLOR.completado },
        { title: "Total lotes", value: String(data.resumen.total), subValue: range ? `${range.startDate} → ${range.endDate}` : "Todas las fechas" },
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
                <DateRangePicker value={range} onChange={setRange} />
                <Button size="sm" className="gap-1.5" onClick={() => fetchData(range)} disabled={loading}>
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
                  Filtrar
                </Button>
              </div>
              {puedeConfigurar && <MuestrasArticleConfig />}
            </div>

            {!data ? (
              <p className="text-muted-foreground">Cargando…</p>
            ) : data.sinConfigurar ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <p className="text-sm">
                  Todavía no hay artículos configurados para este panel.
                  {puedeConfigurar ? " Añade al menos uno con el botón \"Artículos visibles\" de arriba." : " Pide a un responsable que configure la lista."}
                </p>
              </div>
            ) : (
              <>
                <Statistics data={stats} columns={4} />
                <MuestrasTable data={data.muestras} onUpdate={handleUpdate} onBulkUpdate={handleBulkUpdate} />
              </>
            )}
          </main>
        </div>
        <Toaster />
      </NovaPortalProvider>
    </div>
  );
}

export default function MuestrasPage() {
  return (
    <RequireAccess screen="muestras">
      <MuestrasPagePanel />
    </RequireAccess>
  );
}
