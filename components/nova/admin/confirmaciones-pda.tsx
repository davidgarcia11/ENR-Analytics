"use client";

// /admin → Datos › Confirmaciones PDA, sobre Nova: qué aviso se le mostró al operario
// al escanear un SSCC en /consulta-stock-pda y quién/cuándo lo aceptó (trazabilidad
// por si un producto entra en línea por error). Misma API que la pestaña anterior de
// /admin/logs (GET /api/admin/scan-confirmations) — ver DOCUMENTACION.md §7.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import DatePicker from "@/components/nova/date-picker";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Input } from "@/components/nova/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";

type Estado = "correcto" | "aviso" | "no_encontrado" | "sin_fecha" | "otra_subplanta";

interface Confirmacion {
  id: number;
  user_id: number | null;
  username: string;
  sscc: string;
  articulo: string | null;
  estado: Estado;
  mensajes: string; // JSON array
  created_at: string;
}

// Mismo formato "bg-x/10 text-x" que el resto de estados en Nova
const ESTADO_INFO: Record<Estado, { label: string; className: string }> = {
  correcto: { label: "Correcto", className: "bg-emerald-400/10 text-emerald-600" },
  aviso: { label: "Aviso", className: "bg-rose-400/10 text-rose-500" },
  no_encontrado: { label: "No encontrado", className: "bg-rose-400/10 text-rose-500" },
  sin_fecha: { label: "Sin fecha", className: "bg-amber-400/10 text-amber-600" },
  otra_subplanta: { label: "Otra sub-planta", className: "bg-amber-400/10 text-amber-600" },
};

const TODOS = "todos";
const ESTADO_ITEMS = [{ value: TODOS, label: "Todos los resultados" }, ...Object.entries(ESTADO_INFO).map(([value, v]) => ({ value, label: v.label }))];

function parseMensajes(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [String(v)];
  } catch {
    return [json];
  }
}

const fechaHora = (iso: string) =>
  new Date(iso + "Z").toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function AdminConfirmacionesPda({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [confirmaciones, setConfirmaciones] = useState<Confirmacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [usernames, setUsernames] = useState<string[]>([]);

  // Filtros: se editan libremente y solo se aplican con "Filtrar"
  const [filterUsername, setFilterUsername] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterSscc, setFilterSscc] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterTrigger, setFilterTrigger] = useState(0);

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams({ page: String(page) });
        if (filterUsername) params.set("username", filterUsername);
        if (filterEstado) params.set("estado", filterEstado);
        if (filterSscc) params.set("sscc", filterSscc);
        if (filterStartDate) params.set("startDate", filterStartDate);
        if (filterEndDate) params.set("endDate", filterEndDate);

        const res = await apiFetch(`/api/admin/scan-confirmations?${params}`);
        if (res.ok) {
          const data = await res.json();
          setConfirmaciones(data.confirmations);
          setTotalPages(data.totalPages);
          setTotal(data.total);
          setUsernames(data.usernames);
        }
      } finally {
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterTrigger]);

  const aplicarFiltros = () => { setPage(1); setFilterTrigger((t) => t + 1); };
  const limpiarFiltros = () => {
    setFilterUsername(""); setFilterEstado(""); setFilterSscc(""); setFilterStartDate(""); setFilterEndDate("");
    setPage(1); setFilterTrigger((t) => t + 1);
  };
  const hayFiltros = !!(filterUsername || filterEstado || filterSscc || filterStartDate || filterEndDate);

  const userItems = [{ value: TODOS, label: "Todos los usuarios" }, ...usernames.map((u) => ({ value: u, label: u }))];

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />

      <TablaCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filterSscc}
              onChange={(e) => setFilterSscc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && aplicarFiltros()}
              placeholder="SSCC…"
              className="h-8 w-44 font-mono"
            />
            <Select items={userItems} value={filterUsername || TODOS} onValueChange={(v) => setFilterUsername(v === TODOS ? "" : (v as string))}>
              <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {userItems.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={ESTADO_ITEMS} value={filterEstado || TODOS} onValueChange={(v) => setFilterEstado(v === TODOS ? "" : (v as string))}>
              <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ESTADO_ITEMS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="w-40"><DatePicker value={filterStartDate} onChange={setFilterStartDate} /></div>
            <span className="text-sm text-muted-foreground">a</span>
            <div className="w-40"><DatePicker value={filterEndDate} onChange={setFilterEndDate} /></div>
            <Button size="sm" onClick={aplicarFiltros}>Filtrar</Button>
            {hayFiltros && <Button size="sm" variant="ghost" onClick={limpiarFiltros}>Limpiar</Button>}
          </div>
        }
        extra={cargando ? null : `${total.toLocaleString("es-ES")} confirmaci${total === 1 ? "ón" : "ones"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>SSCC</TableHead>
              <TableHead>Artículo</TableHead>
              <TableHead>Resultado aceptado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || confirmaciones.length === 0 ? (
              <FilaVacia colSpan={5} cargando={cargando} texto="No hay confirmaciones para los filtros seleccionados" />
            ) : (
              confirmaciones.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap align-top text-muted-foreground tabular-nums">{fechaHora(c.created_at)}</TableCell>
                  <TableCell className={`align-top ${c.user_id ? "font-medium text-foreground" : "text-muted-foreground italic"}`}>{c.username}</TableCell>
                  <TableCell className="align-top font-mono text-sm text-foreground">{c.sscc}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{c.articulo || "—"}</TableCell>
                  <TableCell className="align-top">
                    <div className="space-y-1">
                      <Badge className={ESTADO_INFO[c.estado].className}>{ESTADO_INFO[c.estado].label}</Badge>
                      {parseMensajes(c.mensajes).map((m, i) => (
                        <p key={i} className="text-xs whitespace-normal text-muted-foreground">{m}</p>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))
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
