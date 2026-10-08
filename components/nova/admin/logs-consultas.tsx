"use client";

// /admin → Datos › Logs de consultas, sobre Nova. Misma API que la página anterior
// (GET /api/admin/logs: paginación, filtros, estadísticas, actividad diaria y ranking
// de usuarios) y la misma exportación a Excel — ver DOCUMENTACION.md §7.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, LogIn } from "lucide-react";
import * as XLSX from "xlsx";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useApiFetch } from "@/components/SessionProvider";
import Statistics from "@/components/shadcn-space/blocks/statistics-04/statistics";
import DatePicker from "@/components/nova/date-picker";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/nova/ui/chart";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface LogEntry {
  id: number;
  user_id: number | null;
  username: string;
  source: string;
  filters: string;
  result_count: number;
  execution_time_ms: number;
  created_at: string;
}

interface Stats {
  totalQueries: number;
  avgTime: number;
  maxTime: number;
  minTime: number;
  avgResults: number;
}

interface DailyStat {
  day: string;
  queries: number;
  avgTime: number;
  uniqueUsers: number;
}

interface TopUser {
  username: string;
  queries: number;
}

export const SOURCE_LABELS: Record<string, string> = {
  produccion: "Producción",
  pedidos: "Preparación Pedidos",
  login: "Login",
  caducados_obsoletos: "Palets Caducados",
  comparativa_seres: "Comparativa SERES",
  consulta_stock_pda: "Consulta Stock PDA",
  compras: "Compras",
  mrp: "Explosión de compras",
  coste_a1: "Costes",
  muestras: "Muestras",
  "muestras-sync": "Muestras (sincronización)",
  loteadora: "Loteadora",
};

const SYNC_TRIGGER_LABELS: Record<string, string> = {
  scheduled: "automática (30 min)",
  "config-change": "cambio de lista de artículos",
  manual: "botón manual en /admin",
};

const PLANT_NAMES: Record<string, string> = { "10100": "Aguilar", "10200": "Corella", "10300": "Funes", all: "Todas" };

// Umbral en ms para marcar consultas lentas
const SLOW_QUERY_MS = 3000;

// Base UI Select no distingue "" de "sin valor": "todos" es el valor del desplegable
const TODOS = "todos";

const DIAS_GRAFICO = [7, 14, 30, 90];

const chartConfig = {
  // Grises del tema Nova (--chart-*), elegidos a propósito para este panel
  consultas: { label: "Consultas", color: "var(--chart-1)" },
  tiempo: { label: "Tiempo medio (s)", color: "var(--chart-2)" },
} satisfies ChartConfig;

function isLoginLog(filtersJson: string): boolean {
  try {
    return JSON.parse(filtersJson).action === "login";
  } catch {
    return false;
  }
}

function summarizeFilters(filtersJson: string): string {
  try {
    const f = JSON.parse(filtersJson);
    if (f.action === "login") return "Inicio de sesión";

    if (f.trigger) {
      const trigger = SYNC_TRIGGER_LABELS[f.trigger] || f.trigger;
      const n = f.articulosConfigurados ?? 0;
      const base = `Disparada por: ${trigger} · ${n} artículo${n === 1 ? "" : "s"} configurado${n === 1 ? "" : "s"}`;
      return f.error ? `${base} · Error: ${f.error}` : base;
    }

    const parts: string[] = [];
    const plantName = f.plant ? PLANT_NAMES[f.plant] || f.plant : null;
    if (plantName) parts.push(plantName);

    if (f.startDate && f.endDate) {
      const fmt = (d: string) => new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
      parts.push(f.startDate === f.endDate ? fmt(f.startDate) : `${fmt(f.startDate)} - ${fmt(f.endDate)}`);
    }

    const categoryFields = ["articles", "prp6s", "srp3s", "srp5s", "srp2s", "srp1s", "srp4s", "ze03s", "prodLines"];
    let catCount = 0;
    for (const key of categoryFields) {
      if (Array.isArray(f[key]) && f[key].length > 0) catCount += f[key].length;
    }
    if (catCount > 0) parts.push(`${catCount} filtro${catCount > 1 ? "s" : ""}`);

    // Filtros de caducados
    if (f.type && f.type !== "todos") parts.push(f.type.charAt(0).toUpperCase() + f.type.slice(1));
    if (f.location && f.location !== "all") parts.push(f.location === "__blank__" ? "Genérica" : f.location);

    return parts.length > 0 ? parts.join(" · ") : "Sin filtros";
  } catch {
    return "Sin filtros";
  }
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const fechaHora = (iso: string) =>
  new Date(iso + "Z").toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const PANEL_ITEMS = [{ value: TODOS, label: "Todos los paneles" }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))];

export default function AdminLogsConsultas({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ totalQueries: 0, avgTime: 0, maxTime: 0, minTime: 0, avgResults: 0 });
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [invitadoCount, setInvitadoCount] = useState(0);
  const [chartDays, setChartDays] = useState(14);

  // Filtros: se editan libremente y solo se aplican con "Filtrar"
  const [filterUsername, setFilterUsername] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [usernames, setUsernames] = useState<string[]>([]);
  const [filterTrigger, setFilterTrigger] = useState(0);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams({ page: String(page), chartDays: String(chartDays) });
        if (filterUsername) params.set("username", filterUsername);
        if (filterStartDate) params.set("startDate", filterStartDate);
        if (filterEndDate) params.set("endDate", filterEndDate);
        if (filterSource) params.set("source", filterSource);

        const res = await apiFetch(`/api/admin/logs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs);
          setTotalPages(data.totalPages);
          setTotal(data.total);
          setUsernames(data.usernames);
          setStats(data.stats);
          setDailyStats(data.dailyStats || []);
          setTopUsers(data.topUsers || []);
          setInvitadoCount(data.invitadoCount || 0);
        }
      } finally {
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterTrigger, chartDays]);

  const hayFiltros = !!(filterUsername || filterStartDate || filterEndDate || filterSource);
  // Lo que se muestra en los KPIs corresponde a los filtros de la última búsqueda, no
  // a lo que haya escrito ahora mismo sin aplicar.
  const [filtrosAplicados, setFiltrosAplicados] = useState(false);
  const aplicarFiltros = () => { setFiltrosAplicados(hayFiltros); setPage(1); setFilterTrigger((t) => t + 1); };
  const limpiarFiltros = () => {
    setFilterUsername(""); setFilterStartDate(""); setFilterEndDate(""); setFilterSource("");
    setFiltrosAplicados(false); setPage(1); setFilterTrigger((t) => t + 1);
  };

  const exportarExcel = () => {
    const rows = logs.map((log) => ({
      Fecha: new Date(log.created_at + "Z").toLocaleString("es-ES"),
      Usuario: log.username,
      Panel: SOURCE_LABELS[log.source] || log.source,
      Filtros: summarizeFilters(log.filters),
      Resultados: isLoginLog(log.filters) ? "" : log.result_count,
      "Tiempo (ms)": isLoginLog(log.filters) ? "" : log.execution_time_ms,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 35 }, { wch: 12 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logs");
    XLSX.writeFile(wb, `Logs_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const chartData = dailyStats.map((d) => ({
    dia: new Date(d.day).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }),
    consultas: d.queries,
    tiempo: Number((d.avgTime / 1000).toFixed(1)),
  }));

  const userItems = [{ value: TODOS, label: "Todos los usuarios" }, ...usernames.map((u) => ({ value: u, label: u }))];

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <Button variant="outline" onClick={exportarExcel} disabled={logs.length === 0}>
          <Download />
          Exportar página
        </Button>
      </CabeceraSeccion>

      <div className="-my-4">
        <Statistics
          data={[
            { title: "Consultas", value: stats.totalQueries.toLocaleString("es-ES"), subValue: filtrosAplicados ? "con los filtros aplicados" : "en total" },
            { title: "Tiempo medio", value: formatTime(stats.avgTime), subValue: `mínimo ${formatTime(stats.minTime)}` },
            {
              title: "Tiempo máximo",
              value: formatTime(stats.maxTime),
              subValue: stats.maxTime > SLOW_QUERY_MS ? `más de ${SLOW_QUERY_MS / 1000}s` : "sin consultas lentas",
              tone: stats.maxTime > SLOW_QUERY_MS ? "destructive" : undefined,
            },
            { title: "Resultados de media", value: Math.round(stats.avgResults).toLocaleString("es-ES"), subValue: "filas por consulta" },
          ]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Actividad</CardTitle>
            <CardDescription>Consultas y tiempo medio por día, últimos {chartDays} días</CardDescription>
            <CardAction>
              <div className="flex rounded-lg border p-0.5">
                {DIAS_GRAFICO.map((d) => (
                  <Button key={d} size="xs" variant={chartDays === d ? "secondary" : "ghost"} onClick={() => setChartDays(d)}>
                    {d}d
                  </Button>
                ))}
              </div>
            </CardAction>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No hay datos suficientes para el gráfico</p>
            ) : (
              <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                <AreaChart data={chartData} margin={{ top: 8, right: 0, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="dia" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                  <YAxis yAxisId="consultas" tickLine={false} axisLine={false} allowDecimals={false} width={40} />
                  <YAxis yAxisId="tiempo" orientation="right" tickLine={false} axisLine={false} unit="s" width={40} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area yAxisId="consultas" dataKey="consultas" type="monotone" fill="var(--color-consultas)" fillOpacity={0.15} stroke="var(--color-consultas)" strokeWidth={2} />
                  <Area yAxisId="tiempo" dataKey="tiempo" type="monotone" fill="var(--color-tiempo)" fillOpacity={0.08} stroke="var(--color-tiempo)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usuarios más activos</CardTitle>
            <CardDescription>Por número de consultas</CardDescription>
          </CardHeader>
          <CardContent>
            {topUsers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {topUsers.map((u, i) => {
                  const max = topUsers[0]?.queries || 1;
                  return (
                    <div key={u.username} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <span className="w-4 text-xs text-muted-foreground">{i + 1}</span>
                          <span className="font-medium text-foreground">{u.username}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">{u.queries.toLocaleString("es-ES")}</span>
                      </div>
                      <div className="ml-6 h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(u.queries / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {invitadoCount > 0 && (
                  <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span>Anónimas (sin sesión)</span>
                    <span className="tabular-nums">{invitadoCount.toLocaleString("es-ES")}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TablaCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select items={PANEL_ITEMS} value={filterSource || TODOS} onValueChange={(v) => setFilterSource(v === TODOS ? "" : (v as string))}>
              <SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PANEL_ITEMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={userItems} value={filterUsername || TODOS} onValueChange={(v) => setFilterUsername(v === TODOS ? "" : (v as string))}>
              <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {userItems.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="w-40"><DatePicker value={filterStartDate} onChange={setFilterStartDate} /></div>
            <span className="text-sm text-muted-foreground">a</span>
            <div className="w-40"><DatePicker value={filterEndDate} onChange={setFilterEndDate} /></div>
            <Button size="sm" onClick={aplicarFiltros}>Filtrar</Button>
            {hayFiltros && <Button size="sm" variant="ghost" onClick={limpiarFiltros}>Limpiar</Button>}
          </div>
        }
        extra={cargando ? null : `${total.toLocaleString("es-ES")} registro${total === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Panel</TableHead>
              <TableHead>Filtros</TableHead>
              <TableHead className="text-right">Resultados</TableHead>
              <TableHead className="text-right">Tiempo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || logs.length === 0 ? (
              <FilaVacia colSpan={6} cargando={cargando} texto="No hay consultas para los filtros seleccionados" />
            ) : (
              logs.map((log) => {
                const esLogin = isLoginLog(log.filters);
                const lenta = !esLogin && log.execution_time_ms > SLOW_QUERY_MS;
                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{fechaHora(log.created_at)}</TableCell>
                    <TableCell className={log.user_id ? "font-medium text-foreground" : "text-muted-foreground italic"}>{log.username}</TableCell>
                    <TableCell>
                      <Badge variant={esLogin ? "outline" : "secondary"} className="font-normal">
                        {esLogin && <LogIn />}
                        {SOURCE_LABELS[log.source] || log.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground" title={esLogin ? "Inicio de sesión" : log.filters}>
                      {summarizeFilters(log.filters)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">
                      {esLogin ? "—" : log.result_count?.toLocaleString("es-ES") ?? "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${lenta ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {esLogin ? "—" : log.execution_time_ms != null ? formatTime(log.execution_time_ms) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">Página {page} de {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || cargando} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft />Anterior
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || cargando} onClick={() => setPage((p) => p + 1)}>
                Siguiente<ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </TablaCard>
    </>
  );
}
