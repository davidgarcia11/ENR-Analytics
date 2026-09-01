// Coste A1 y despiece recursivo de materiales — para cada artículo "final" (el que
// realmente se vende, ver /api/coste-a1), su coste A1 (F30026) y el árbol completo
// de su lista de materiales (F3002, planta 10999), nivel a nivel. Foto del estado
// VIGENTE HOY, no histórica por mes (a diferencia de MRP). Ver ClickUp #869eq7vnp.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import CosteA1Table, { CosteA1FilterBar, useCosteA1Filters, type DespieceNode } from "@/components/nova/coste-a1-table";
import CosteA1DesglosePanel from "@/components/nova/coste-a1-desglose-panel";
import { Button } from "@/components/nova/ui/button";
import { Toaster } from "@/components/nova/ui/sonner";

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

interface CosteA1Response {
  finales: DespieceNode[];
  meta: { totalFinales: number; articulosDistintos: number };
}

// Recorre el árbol para aplanarlo a filas (exportación Excel) y para las medias de
// las tarjetas KPI — misma forma de recorrido, dos usos distintos.
function aplanar(nodos: DespieceNode[], raiz: string, nivel: number): (DespieceNode & { articuloFinal: string; nivel: number })[] {
  return nodos.flatMap((n) => [
    { ...n, articuloFinal: raiz, nivel },
    ...aplanar(n.children, raiz, nivel + 1),
  ]);
}

export default function CosteA1Page() {
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

  // Mismo patrón que el resto de paneles (ver app/compras/page.tsx) — solo para
  // mostrar quién ha entrado y poder cerrar sesión desde la cabecera. El control de
  // acceso real ya lo hace requireScreenAccess('coste_a1') en api/coste-a1/route.ts.
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

  const [data, setData] = useState<CosteA1Response | null>(null);
  const [loading, setLoading] = useState(false);
  // Artículo final elegido en la tabla (clic en una fila raíz) — su desglose se
  // ve en el panel de la derecha, ver components/nova/coste-a1-desglose-panel.tsx.
  const [selectedCodigo, setSelectedCodigo] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const id = toast.loading("Calculando coste y despiece…");
    try {
      const res = await fetch("/api/coste-a1");
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const json: CosteA1Response = await res.json();
      setData(json);
      // Selecciona el primer artículo final por defecto (o lo mantiene si sigue
      // presente tras un Recalcular).
      setSelectedCodigo((actual) =>
        actual && json.finales.some((n) => n.codigo === actual) ? actual : json.finales[0]?.codigo ?? null
      );
      toast.success(`${json.finales.length} artículos finales calculados`, { id });
    } catch (err) {
      console.error("Error cargando coste A1:", err);
      toast.error("No se ha podido calcular el coste y despiece", { id });
    } finally {
      setLoading(false);
    }
  }, [router]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const exportToExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const resumenRows = data.finales.map((n) => ({
      Codigo: n.codigo, Descripcion: n.descripcion, Tipo: n.tipo, Familia: n.familiaDescripcion,
      CosteA1: n.costeA1 != null ? Math.round(n.costeA1 * 10000) / 10000 : "",
    }));
    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 14 }, { wch: 34 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "Coste por articulo final");

    const detalleRows = data.finales.flatMap((n) =>
      aplanar(n.children, n.codigo, 1).map((d) => ({
        ArticuloFinal: n.codigo, Nivel: d.nivel, Codigo: d.codigo, Descripcion: d.descripcion,
        Tipo: d.tipo, Cantidad: Math.round(d.cantidad * 1000) / 1000, UM: d.um,
        CosteA1: d.costeA1 != null ? Math.round(d.costeA1 * 10000) / 10000 : "",
      }))
    );
    const wsDetalle = XLSX.utils.json_to_sheet(detalleRows);
    wsDetalle["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Despiece completo");

    XLSX.writeFile(wb, `Coste_A1_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const selectedNode = useMemo(
    () => (data && selectedCodigo ? data.finales.find((n) => n.codigo === selectedCodigo) ?? null : null),
    [data, selectedCodigo]
  );

  // Estado de filtros de la tabla (buscador, familia, obsoletos) — se muestra arriba
  // de los KPI (junto a Recalcular/Exportar, igual que /compras) pero lo consume la
  // tabla, más abajo; de ahí el hook compartido en vez de tenerlo dentro de la tabla.
  const filtros = useCosteA1Filters(data?.finales ?? []);

  const portalContainerRef = useRef<HTMLDivElement>(null);

  const conCoste = data ? data.finales.filter((n) => n.costeA1 != null) : [];
  const costeMedio = conCoste.length > 0 ? conCoste.reduce((s, n) => s + (n.costeA1 ?? 0), 0) / conCoste.length : null;
  const stats = data
    ? [
        { title: "Artículos finales", value: data.meta.totalFinales.toLocaleString("es-ES"), subValue: "Se venden tal cual, vigente hoy" },
        { title: "Coste A1 medio", value: costeMedio != null ? `${costeMedio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : "—", subValue: "Media de los que tienen coste" },
        { title: "Sin coste A1", value: String(data.meta.totalFinales - conCoste.length), subValue: "F30026 sin fila (07/A1)" },
        { title: "Artículos en los árboles", value: data.meta.articulosDistintos.toLocaleString("es-ES"), subValue: "Distintos, en todos los despieces" },
      ]
    : [];

  return (
    <div data-nova-theme={effectiveTheme} ref={portalContainerRef} className="min-h-screen bg-sidebar text-foreground">
      <NovaPortalProvider container={portalContainerRef}>
        <div className="md:m-2 md:rounded-xl md:outline md:outline-border md:shadow-sm md:overflow-hidden bg-background">
          <Header user={sessionUser} onLogout={logout} mode={mode} onModeChange={setMode} />
          {/* Mismo ancho que el resto de paneles (max-w-7xl, igual que /compras) */}
          <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fetchData()} disabled={loading}>
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Recalcular
              </Button>
              <CosteA1FilterBar filtros={filtros} />
              <Button size="sm" className="ml-auto gap-1.5" onClick={exportToExcel} disabled={!data || data.finales.length === 0}>
                <Download size={14} />
                Exportar
              </Button>
            </div>

            {!data ? (
              <p className="text-muted-foreground">Cargando…</p>
            ) : (
              <>
                <Statistics data={stats} columns={4} />
                {/* Vuelta a 2/3-1/3: el ancho exterior de tabla/panel no debía
                    tocarse ("el componente completo fuera igual de grande, ni
                    más ni menos") — probar 3/5-2/5 dejaba la tabla sin verse
                    entera sin deslizar. El sitio de más para el desglose sale
                    de reducir el margen INTERNO del panel, no de ensancharlo
                    por fuera — ver CosteA1DesglosePanel. */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <CosteA1Table filtros={filtros} selectedCodigo={selectedCodigo} onSelectCodigo={setSelectedCodigo} />
                  </div>
                  <div className="lg:col-span-1">
                    <CosteA1DesglosePanel node={selectedNode} />
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
        <Toaster />
      </NovaPortalProvider>
    </div>
  );
}
