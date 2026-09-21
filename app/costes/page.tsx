// Coste A1 y despiece recursivo de materiales — para cada artículo "final" (el que
// realmente se vende, ver /api/costes), su coste A1 (F30026) y el árbol completo
// de su lista de materiales (F3002, planta 10999), nivel a nivel. Foto del estado
// VIGENTE HOY, no histórica por mes (a diferencia de MRP). Ver ClickUp #869eq7vnp.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider";
import { toast } from "sonner";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import CosteA1Table, { CosteA1FilterBar, useCosteA1Filters, type DespieceNode } from "@/components/nova/coste-a1-table";
import CosteA1DesglosePanel from "@/components/nova/coste-a1-desglose-panel";
import CosteMensualChart from "@/components/shadcn-space/blocks/chart-03/chart";
import TopImpactoChart from "@/components/shadcn-space/blocks/chart-04/chart";
import { extremosImpacto, formatMesCorto, serieCosteMensual } from "@/components/nova/coste-a1-shared";
import { Button } from "@/components/nova/ui/button";
import { Toaster } from "@/components/nova/ui/sonner";


interface CosteA1Response {
  finales: DespieceNode[];
  meta: { totalFinales: number; articulosDistintos: number; mesesRango: string[] };
}

// Recorre el árbol para aplanarlo a filas (exportación Excel) y para las medias de
// las tarjetas KPI — misma forma de recorrido, dos usos distintos.
function aplanar(nodos: DespieceNode[], raiz: string, nivel: number): (DespieceNode & { articuloFinal: string; nivel: number })[] {
  return nodos.flatMap((n) => [
    { ...n, articuloFinal: raiz, nivel },
    ...aplanar(n.children, raiz, nivel + 1),
  ]);
}

function CosteA1PagePanel() {
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



  const [data, setData] = useState<CosteA1Response | null>(null);
  const [loading, setLoading] = useState(false);
  // Artículo final elegido en la tabla (clic en una fila raíz) — su desglose se
  // ve en el panel de la derecha, ver components/nova/coste-a1-desglose-panel.tsx.
  const [selectedCodigo, setSelectedCodigo] = useState<string | null>(null);

  // Estado de filtros de la tabla (buscador, familia, rango de meses) — se
  // muestra arriba de los KPI (junto a Exportar, igual que /compras) pero lo
  // consume la tabla, más abajo; de ahí el hook compartido en vez de tenerlo
  // dentro de la tabla. Declarado ANTES de `fetchData` — necesita leer
  // `filtros.monthRange` para pedir la producción del rango elegido.
  const filtros = useCosteA1Filters(data?.finales ?? []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const id = toast.loading("Calculando coste y despiece…");
    try {
      const params = new URLSearchParams({
        startDate: filtros.monthRange.startDate,
        endDate: filtros.monthRange.endDate,
      });
      const res = await apiFetch(`/api/costes?${params}`);
      // Bug real visto en directo: un corte de conexión con Oracle (NJS-500,
      // ECONNRESET) hace que la API devuelva 500 con `{ error: '...' }`, sin
      // `finales` — sin este chequeo, `json.finales.length` de más abajo
      // petaba la página entera en vez de mostrar el error.
      if (!res.ok) throw new Error(`API devolvió ${res.status}`);
      const json: CosteA1Response = await res.json();
      setData(json);
      toast.success(`${json.finales.length} artículos finales calculados`, { id });
    } catch (err) {
      console.error("Error cargando coste A1:", err);
      toast.error("No se ha podido calcular el coste y despiece", { id });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filtros.monthRange]);

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

  // Selecciona por defecto el primer artículo VISIBLE en la tabla — bug real
  // corregido: antes se elegía `json.finales[0]` dentro de `fetchData` (orden
  // crudo de la API, sin pasar por búsqueda/familia ni por la regla de
  // "obsoleto solo se ve si tuvo producción en el rango"), así que en la
  // primera carga podía aparecer seleccionado en el panel de desglose un
  // artículo obsoleto que la tabla ni siquiera mostraba. `filtros.treeData` ya
  // está podado/filtrado/ordenado igual que lo que renderiza la tabla — se
  // mantiene la selección actual si sigue siendo visible ahí; si no (primera
  // carga, o se acaba de filtrar fuera con la búsqueda/familia), cae al
  // primero de esa misma lista.
  useEffect(() => {
    if (!data) return;
    setSelectedCodigo((actual) =>
      actual && filtros.treeData.some((n) => n.codigo === actual) ? actual : filtros.treeData[0]?.codigo ?? null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filtros.treeData]);

  const portalContainerRef = useRef<HTMLDivElement>(null);

  // Gráficos "Coste real vs. teórico" y "Top artículos por impacto" (arriba de
  // la tabla) — agregan VARIOS finales a la vez, a diferencia de la tabla (un
  // artículo por fila): mismos artículos que la tabla tiene filtrados en cada
  // momento (búsqueda/familia, `filtros.filtered`), confirmado con el usuario.
  // Ver serieCosteMensual()/extremosImpacto() (coste-a1-shared.tsx) para el
  // porqué de la ponderación y del orden.
  const serieCoste = useMemo(
    () =>
      serieCosteMensual(filtros.filtered, data?.meta.mesesRango ?? []).map((p) => ({
        mes: formatMesCorto(p.mes),
        teorico: p.teorico,
        real: p.real,
      })),
    [filtros.filtered, data?.meta.mesesRango]
  );
  const topImpacto = useMemo(() => extremosImpacto(filtros.filtered), [filtros.filtered]);

  // KPI — pedido explícito de renovarlos: los 4 originales (Artículos
  // finales/Coste A1 medio/Sin coste A1/Artículos en los árboles) describían
  // la foto ESTÁTICA del catálogo (BOM), de antes de que existiera el coste
  // real; con la comparación real vs. teórico como foco actual del panel,
  // esos datos ya no eran lo más útil de un vistazo. Mismo alcance que los
  // gráficos de arriba (`filtros.filtered`, no el dataset sin filtrar) — para
  // que KPI, gráficos y tabla cuenten siempre la misma historia.
  const visibles = filtros.filtered;
  // Coincide con la misma regla de "misma población" del gráfico
  // (serieCosteMensual, coste-a1-shared.tsx): solo entran en la desviación
  // ponderada los artículos con coste real Y cantidad costeada > 0 en el rango.
  // El peso es la cantidad producida en las órdenes que generaron el coste
  // (`costeRealPorMes[].cantidad`), no la producción de F4111 (`produccion`,
  // otra fuente) — así el € del impacto es exactamente "sobre lo que se costeó".
  const cantidadCosteada = (n: DespieceNode) => (n.costeRealPorMes ?? []).reduce((s, m) => s + m.cantidad, 0);
  const conDesviacionPonderable = visibles.filter((n) => n.costeReal != null && n.costeA1 != null && cantidadCosteada(n) > 0);
  const sumaPesos = conDesviacionPonderable.reduce((s, n) => s + cantidadCosteada(n), 0);
  const sumaTeoricoPonderado = conDesviacionPonderable.reduce((s, n) => s + (n.costeA1 ?? 0) * cantidadCosteada(n), 0);
  const sumaRealPonderado = conDesviacionPonderable.reduce((s, n) => s + (n.costeReal ?? 0) * cantidadCosteada(n), 0);
  const desviacionMedia = sumaPesos > 0 && sumaTeoricoPonderado > 0 ? ((sumaRealPonderado - sumaTeoricoPonderado) / sumaTeoricoPonderado) * 100 : null;
  // Impacto económico de la desviación en euros — sustituye a "Artículos con
  // coste real" (contador de catálogo, poco útil para una directora
  // financiera). Mismo criterio de población y mismo peso que desviacionMedia.
  const impactoEuros = sumaPesos > 0 ? sumaRealPonderado - sumaTeoricoPonderado : null;
  const produccionTotal = visibles.reduce((s, n) => s + (n.produccion ?? 0), 0);

  const stats = data
    ? [
        {
          title: "Desviación media (real vs. teórico)",
          value: desviacionMedia != null
            ? `${desviacionMedia > 0 ? "+" : ""}${desviacionMedia.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
            : "—",
          subValue: "Ponderada por cantidad costeada, artículos filtrados",
          // Mismo criterio de color que DesviacionBadge (coste-a1-shared.tsx):
          // positivo = sobrecoste (destructive), negativo = ahorro (success).
          // Exactamente 0 o sin dato se queda en el color neutro.
          tone: desviacionMedia != null && desviacionMedia !== 0 ? (desviacionMedia > 0 ? "destructive" as const : "success" as const) : undefined,
        },
        {
          title: "Impacto de la desviación",
          value:
            impactoEuros != null
              ? `${impactoEuros > 0 ? "+" : ""}${impactoEuros.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`
              : "—",
          subValue: impactoEuros != null ? (impactoEuros > 0 ? "Sobrecoste frente al teórico" : "Ahorro frente al teórico") : "Sin datos ponderables",
          tone: impactoEuros != null && impactoEuros !== 0 ? (impactoEuros > 0 ? "destructive" as const : "success" as const) : undefined,
        },
        {
          title: "Producción total",
          value: produccionTotal.toLocaleString("es-ES", { maximumFractionDigits: 0 }),
          subValue: "Unidades, rango y artículos filtrados",
        },
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
              <CosteA1FilterBar filtros={filtros} onFiltrarFechas={() => fetchData()} loading={loading} />
              <Button size="sm" className="ml-auto gap-1.5" onClick={exportToExcel} disabled={!data || data.finales.length === 0}>
                <Download size={14} />
                Exportar
              </Button>
            </div>

            {!data ? (
              <p className="text-muted-foreground">Cargando…</p>
            ) : (
              <>
                <Statistics data={stats} columns={3} />
                {/* Coste real vs. teórico (área) + Producción (barras), mismo
                    reparto 2/3-1/3 que la fila de tabla+desglose de abajo —
                    pedido explícito, "dos componentes arriba". */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <CosteMensualChart data={serieCoste} className="h-full" />
                  </div>
                  <div className="lg:col-span-1">
                    <TopImpactoChart data={topImpacto} onSelect={setSelectedCodigo} className="h-full" />
                  </div>
                </div>
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

export default function CosteA1Page() {
  return (
    <RequireAccess screen="costes">
      <CosteA1PagePanel />
    </RequireAccess>
  );
}
