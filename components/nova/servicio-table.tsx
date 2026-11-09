"use client";

// Tabla de /servicio — una fila por envío (pedido + albarán). Búsqueda y filtros locales;
// los datos manuales (fecha de entrega real, transportista, incidencia...) se editan en un
// Dialog por fila. Estilo del bloque Table 09 de ShadcnSpace (Popular Products): celdas de
// dos líneas, icono, barra de progreso, insignia de estado y menú «⋮», con márgenes
// laterales amplios. Ver components/nova/README.md.
import { useEffect, useMemo, useState } from "react";
import { SearchX, Loader2, EllipsisVertical, SquarePen } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Button } from "@/components/nova/ui/button";
import { Progress } from "@/components/nova/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/nova/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Card } from "@/components/nova/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import PremiumRibbon from "@/components/shadcn-space/pagination/pagination-02";
import { motivoEfectivo, tieneIncidencia, type EstadoEntrega } from "@/lib/servicio";
import { cn } from "@/lib/utils";

export interface EnvioDto {
  pedido: number;
  suPedido: string;
  albaran: number;
  cliente: number; // SDAN8: lo usa el filtro de clientes
  clienteNombre: string;
  destinoNombre: string;
  canal: string | null;
  canalLabel: string | null;
  fechaEnvio: string | null;
  fechaPrometida: string | null;
  udsPedidas: number;
  udsEnviadas: number;
  pedidoUdsPedidas: number;
  pedidoUdsEnviadas: number;
  cajasPedidas: number;
  cajasEnviadas: number;
  udsCanceladas: number;
  pedidoCajasPedidas: number;
  pedidoCajasEnviadas: number;
  pedidoCompleto: boolean;
  transportista: string;
  fechaEntregaReal: string | null;
  responsable: string;
  motivo: string;
  incidencia: string;
  udsAfectadas: number;
  cajasAfectadas: number;
  entrega: EstadoEntrega;
}

export interface PatchEnvio {
  transportista?: string;
  fechaEntregaReal?: string | null;
  responsable?: string;
  motivo?: string;
  incidencia?: string;
  udsAfectadas?: number;
  cajasAfectadas?: number;
}

export interface CatalogosServicio {
  motivos: string[];
  responsables: string[];
  transportistas: string[];
}

export const ENTREGA_LABEL: Record<EstadoEntrega, string> = {
  pendiente_envio: "Sin enviar",
  sin_confirmar: "Sin confirmar",
  a_tiempo: "A tiempo",
  tarde: "Tarde",
};

const ENTREGA_CLASS: Record<EstadoEntrega, string> = {
  pendiente_envio: "bg-muted text-muted-foreground",
  sin_confirmar: "bg-amber-400/10 text-amber-500",
  a_tiempo: "bg-teal-400/10 text-teal-400",
  tarde: "bg-red-500/10 text-red-500",
};

const PAGE_SIZE = 50;
const NINGUNO = "__ninguno__"; // Base UI no distingue "" de "sin valor" en Select (ver components/nova/README.md)
const num = (n: number) => n.toLocaleString("es-ES");
const numCajas = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 1 }); // las enviadas pueden salir con decimales (reparto proporcional)
const fecha = (iso: string | null) => (iso ? iso.split("-").reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join("/") : "—");
// Avatar de la fila: iniciales del cliente sobre el color de su canal (en vez de un icono
// igual para todas las filas). Los colores se asignan por código de canal, estables.
const COLORES_CANAL = ["bg-blue-500/10 text-blue-500", "bg-teal-400/10 text-teal-500", "bg-amber-400/15 text-amber-600", "bg-sky-400/15 text-sky-600", "bg-violet-500/10 text-violet-500"];
const colorCanal = (canal: string | null) => {
  if (!canal) return "bg-muted text-muted-foreground";
  let h = 0;
  for (const c of canal) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORES_CANAL[h % COLORES_CANAL.length];
};
const iniciales = (nombre: string) => {
  const p = nombre.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
};
const claveDe = (e: { pedido: number; albaran: number }) => `${e.pedido}|${e.albaran}`;

function SelectLista({ valor, opciones, onChange }: { valor: string; opciones: readonly string[]; onChange: (v: string) => void }) {
  // Si el valor guardado se desactivó en /admin, se sigue mostrando (marcado) para no perderlo al editar
  const lista = valor && !opciones.includes(valor) ? [...opciones, valor] : opciones;
  return (
    <Select value={valor || NINGUNO} onValueChange={(v) => onChange(v === NINGUNO ? "" : (v as string))}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue>{(v: string) => (v === NINGUNO ? "—" : v)}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectItem value={NINGUNO}>—</SelectItem>
        {lista.map((o) => <SelectItem key={o} value={o}>{opciones.includes(o) ? o : `${o} (inactivo)`}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function EditarEnvio({ envio, catalogos, onClose, onSave }: { envio: EnvioDto | null; catalogos: CatalogosServicio; onClose: () => void; onSave: (e: EnvioDto, p: PatchEnvio) => Promise<void> }) {
  const [form, setForm] = useState<Required<PatchEnvio>>({ transportista: "", fechaEntregaReal: null, responsable: "", motivo: "", incidencia: "", udsAfectadas: 0, cajasAfectadas: 0 });
  // Las afectadas se anotan en unidades o en cajas; el otro valor se calcula con las unidades por caja de este envío
  const [unidad, setUnidad] = useState<"uds" | "cajas">("uds");
  const udsPorCajaEnvio = envio && envio.cajasPedidas > 0 && envio.udsPedidas > 0 ? envio.udsPedidas / envio.cajasPedidas : null;
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (envio) setForm({ transportista: envio.transportista, fechaEntregaReal: envio.fechaEntregaReal, responsable: envio.responsable, motivo: envio.motivo, incidencia: envio.incidencia, udsAfectadas: envio.udsAfectadas, cajasAfectadas: envio.cajasAfectadas });
    setUnidad("uds");
  }, [envio]);

  const cambiarAfectadas = (texto: string) => {
    const n = Math.max(0, Number(texto) || 0);
    if (unidad === "uds") {
      const uds = Math.trunc(n);
      setForm((f) => ({ ...f, udsAfectadas: uds, cajasAfectadas: udsPorCajaEnvio ? Math.round((uds / udsPorCajaEnvio) * 10) / 10 : f.cajasAfectadas }));
    } else {
      const cajas = Math.round(n * 10) / 10;
      setForm((f) => ({ ...f, cajasAfectadas: cajas, udsAfectadas: udsPorCajaEnvio ? Math.round(cajas * udsPorCajaEnvio) : f.udsAfectadas }));
    }
  };

  const guardar = async () => {
    if (!envio) return;
    setGuardando(true);
    try { await onSave(envio, form); onClose(); } finally { setGuardando(false); }
  };

  return (
    <Dialog open={!!envio} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pedido {envio?.pedido} · {envio?.albaran ? `albarán ${envio.albaran}` : "sin albarán"}</DialogTitle>
          <DialogDescription>
            {envio?.clienteNombre} · prometido para el {fecha(envio?.fechaPrometida ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Fecha de entrega real</Label>
            <Input type="date" value={form.fechaEntregaReal ?? ""} onChange={(e) => setForm({ ...form, fechaEntregaReal: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label>Transportista</Label>
            <SelectLista valor={form.transportista} opciones={catalogos.transportistas} onChange={(v) => setForm({ ...form, transportista: v })} />
            {catalogos.transportistas.length === 0 && (
              <p className="text-xs text-muted-foreground">Aún no hay transportistas: se añaden en Administración → Listas de servicio.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Responsable</Label>
            <SelectLista valor={form.responsable} opciones={catalogos.responsables} onChange={(v) => setForm({ ...form, responsable: v })} />
          </div>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <SelectLista valor={form.motivo} opciones={catalogos.motivos} onChange={(v) => setForm({ ...form, motivo: v })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Incidencia</Label>
            <Input value={form.incidencia} maxLength={500} placeholder="Sin incidencia" onChange={(e) => setForm({ ...form, incidencia: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Afectadas</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                step={unidad === "cajas" ? 0.5 : 1}
                value={unidad === "uds" ? form.udsAfectadas : form.cajasAfectadas}
                onChange={(e) => cambiarAfectadas(e.target.value)}
              />
              <Select value={unidad} onValueChange={(v) => setUnidad(v as "uds" | "cajas")}>
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue>{(v: string) => (v === "uds" ? "Uds" : "Cajas")}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value="uds">Uds</SelectItem>
                  <SelectItem value="cajas" disabled={!udsPorCajaEnvio}>Cajas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {udsPorCajaEnvio
                ? unidad === "uds" ? `≈ ${num(form.cajasAfectadas)} cajas` : `≈ ${num(form.udsAfectadas)} uds`
                : "Este envío no tiene cajas definidas: solo unidades"}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando} className="gap-1.5">
            {guardando && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ServicioTable({ data, catalogos, onSave }: { data: EnvioDto[]; catalogos: CatalogosServicio; onSave: (e: EnvioDto, p: PatchEnvio) => Promise<void> }) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<EstadoEntrega | "todos">("todos");
  const [filtroInc, setFiltroInc] = useState<"todas" | "con" | "sin">("todas");
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<EnvioDto | null>(null);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return data.filter((e) => {
      if (filtro !== "todos" && e.entrega !== filtro) return false;
      if (filtroInc !== "todas" && tieneIncidencia(e) !== (filtroInc === "con")) return false;
      if (!q) return true;
      return [String(e.pedido), e.suPedido, e.clienteNombre, e.destinoNombre, String(e.albaran), e.transportista]
        .some((c) => c.toLowerCase().includes(q));
    });
  }, [data, busqueda, filtro, filtroInc]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  useEffect(() => { setPagina(1); }, [busqueda, filtro, filtroInc]);
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);
  const paginadas = useMemo(() => filtradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE), [filtradas, pagina]);

  return (
    <div className="space-y-3">
      <Card className="gap-6 px-0 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6">
          <div>
            <h5 className="text-lg font-medium text-foreground">Envíos</h5>
            <p className="text-sm text-muted-foreground">{filtradas.length} de {data.length} envío{data.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar pedido, su pedido, cliente, albarán…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="h-8 w-72" />
            <Select value={filtro} onValueChange={(v) => setFiltro(v as EstadoEntrega | "todos")}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue>{(v: EstadoEntrega | "todos") => (v === "todos" ? "Todos los estados" : ENTREGA_LABEL[v])}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="todos">Todos los estados</SelectItem>
                {(Object.keys(ENTREGA_LABEL) as EstadoEntrega[]).map((k) => <SelectItem key={k} value={k}>{ENTREGA_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroInc} onValueChange={(v) => setFiltroInc(v as "todas" | "con" | "sin")}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue>{(v: string) => ({ todas: "Con y sin incidencia", con: "Con incidencia", sin: "Sin incidencia" })[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="todas">Con y sin incidencia</SelectItem>
                <SelectItem value="con">Con incidencia</SelectItem>
                <SelectItem value="sin">Sin incidencia</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {filtradas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <SearchX size={28} />
            <p className="text-sm">Sin envíos que coincidan con el filtro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="ps-6 text-sm">Pedido</TableHead>
                  <TableHead className="text-sm">Cliente</TableHead>
                  <TableHead className="text-sm">Albarán</TableHead>
                  <TableHead className="text-sm">Entrega</TableHead>
                  <TableHead className="text-sm">Unidades</TableHead>
                  <TableHead className="text-sm">Incidencia</TableHead>
                  <TableHead className="text-sm">Estado</TableHead>
                  <TableHead className="pe-4" />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border">
                {paginadas.map((e) => {
                  const pctPedido = e.pedidoUdsPedidas > 0 ? Math.min(100, (e.pedidoUdsEnviadas / e.pedidoUdsPedidas) * 100) : 0;
                  return (
                    <TableRow key={claveDe(e)} className="hover:bg-transparent">
                      <TableCell className="whitespace-nowrap py-3 ps-6">
                        <div className="flex items-center gap-3">
                          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold", colorCanal(e.canal))}>
                            {iniciales(e.clienteNombre)}
                          </span>
                          <div>
                            <h6 className="text-sm font-medium text-foreground">{e.pedido}</h6>
                            <p className="text-xs text-muted-foreground">{e.suPedido || "Sin ref. cliente"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-3" title={e.destinoNombre && e.destinoNombre !== e.clienteNombre ? `${e.clienteNombre} → ${e.destinoNombre}` : e.clienteNombre}>
                        <h6 className="max-w-36 truncate text-sm font-medium text-foreground">{e.clienteNombre || "—"}</h6>
                        <p className="max-w-36 truncate text-xs text-muted-foreground">{e.canalLabel ?? "Sin canal"}{e.transportista ? ` · ${e.transportista}` : ""}</p>
                      </TableCell>
                      <TableCell className="py-3">
                        <h6 className="text-sm font-medium text-foreground">{e.albaran || "—"}</h6>
                        <p className="text-xs text-muted-foreground">Envío {fecha(e.fechaEnvio)}</p>
                      </TableCell>
                      <TableCell className="py-3">
                        <h6 className="text-sm font-medium text-foreground">{fecha(e.fechaPrometida)}</h6>
                        <p className={cn("text-xs", e.entrega === "tarde" ? "text-red-500" : "text-muted-foreground")}>
                          {e.fechaEntregaReal ? `Real ${fecha(e.fechaEntregaReal)}` : "Real sin confirmar"}
                        </p>
                      </TableCell>
                      <TableCell className="py-3" title={`Este albarán: ${num(e.udsEnviadas)} uds${e.cajasPedidas > 0 ? ` · ${numCajas(e.cajasEnviadas)} cajas` : ""}`}>
                        <h6 className="text-sm font-medium tabular-nums text-foreground">
                          {num(e.pedidoUdsEnviadas)} / {num(e.pedidoUdsPedidas)}
                          <span className="font-normal text-foreground/70"> uds</span>
                        </h6>
                        <p className="mb-1.5 text-xs tabular-nums text-muted-foreground">
                          {e.pedidoCajasPedidas > 0 ? `${numCajas(e.pedidoCajasEnviadas)} / ${numCajas(e.pedidoCajasPedidas)} cajas` : "— cajas"}
                        </p>
                        <div className="me-5">
                          <Progress value={pctPedido} className={cn("h-1 w-full", e.pedidoCompleto ? "**:data-[slot=progress-indicator]:bg-teal-400" : "**:data-[slot=progress-indicator]:bg-amber-300")} />
                        </div>
                      </TableCell>
                      <TableCell className="py-3" title={e.incidencia || undefined}>
                        {tieneIncidencia(e) ? (
                          <>
                            <h6 className="text-sm font-medium tabular-nums text-red-500">
                              {e.udsAfectadas > 0 || e.cajasAfectadas > 0 ? `${num(e.udsAfectadas)} uds${e.cajasAfectadas > 0 ? ` · ${numCajas(e.cajasAfectadas)} cajas` : ""}` : e.udsCanceladas > 0 && !e.motivo ? `${num(e.udsCanceladas)} uds` : "Anotada"}
                            </h6>
                            <p className="max-w-40 truncate text-xs text-muted-foreground">{motivoEfectivo(e) || e.incidencia}</p>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge className={cn("text-xs font-normal", ENTREGA_CLASS[e.entrega])}>{ENTREGA_LABEL[e.entrega]}</Badge>
                      </TableCell>
                      <TableCell className="py-3 pe-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="outline-none" aria-label="Acciones">
                            <span className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-accent hover:text-accent-foreground">
                              <EllipsisVertical size={20} />
                            </span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem className="flex cursor-pointer gap-3 font-normal" onClick={() => setEditando(e)}>
                              <SquarePen size={18} />
                              <span>Editar datos</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {filtradas.length > 0 && totalPaginas > 1 && <PremiumRibbon page={pagina} totalPages={totalPaginas} onPageChange={setPagina} />}
      <EditarEnvio envio={editando} catalogos={catalogos} onClose={() => setEditando(null)} onSave={onSave} />
    </div>
  );
}
