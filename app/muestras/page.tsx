// Control de muestras de producto terminado — pendiente / enviado / completado.
// Primera App (no Dashboard) construida sobre Nova/ShadcnSpace. Ver ClickUp #869etmf6d
// y docs/muestras.md.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Filter, Loader2 } from "lucide-react";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import MuestrasTable, { type Muestra, type Estado } from "@/components/nova/muestras-table";
import MuestrasArticleConfig from "@/components/nova/muestras-article-config";
import DateRangePicker, { type DateRange } from "@/components/nova/date-range-picker";
import { Button } from "@/components/nova/ui/button";
import { Toaster } from "@/components/nova/ui/sonner";

interface SessionUser { id: number; username: string; role: string; name: string; surname: string; canConfigureMuestras?: boolean }
interface MuestrasResponse {
  muestras: Muestra[];
  resumen: { total: number; pendientes: number; enviados: number; completados: number };
}

function ultimos30Dias(): DateRange {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export default function MuestrasPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

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

  // Mismo patrón que el resto de paneles Nova — el control de acceso real lo hace
  // requireScreenAccess('muestras') en api/muestras/route.ts.
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

  const [range, setRange] = useState<DateRange>(ultimos30Dias);
  const [data, setData] = useState<MuestrasResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (r: DateRange) => {
    setLoading(true);
    const id = toast.loading("Consultando muestras…");
    try {
      const params = new URLSearchParams({ startDate: r.startDate, endDate: r.endDate });
      const res = await fetch(`/api/muestras?${params.toString()}`);
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const json: MuestrasResponse = await res.json();
      setData(json);
      toast.success(`${json.muestras.length} lotes encontrados`, { id });
    } catch (err) {
      console.error("Error cargando muestras:", err);
      toast.error("No se han podido cargar las muestras", { id });
    } finally {
      setLoading(false);
    }
  }, [router]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(range); }, []);

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

    fetch("/api/muestras", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articulo, lote, ...patch }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
        if (patch.estado) toast.success(`${articulo} · ${lote} → ${patch.estado}`);
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
      const res = await fetch("/api/muestras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, estado }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${items.length} lote${items.length === 1 ? "" : "s"} → ${estado}`);
    } catch {
      toast.error("No se ha podido aplicar el cambio masivo");
      fetchData(range);
    }
  }, [fetchData, range]);

  const portalContainerRef = useRef<HTMLDivElement>(null);
  const puedeConfigurar = sessionUser?.role === "admin" || !!sessionUser?.canConfigureMuestras;

  const stats = data
    ? [
        { title: "Pendientes", value: String(data.resumen.pendientes), subValue: "Sin enviar todavía" },
        { title: "Enviados", value: String(data.resumen.enviados), subValue: "En laboratorio/calidad" },
        { title: "Completados", value: String(data.resumen.completados), subValue: "Resultado recibido" },
        { title: "Total lotes", value: String(data.resumen.total), subValue: `${range.startDate} → ${range.endDate}` },
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
