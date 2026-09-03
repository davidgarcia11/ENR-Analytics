"use client";

// Tabla plana de /muestras — sin jerarquía (a diferencia de hierarchical-table.tsx /
// mrp-materials-table.tsx): una fila por lote. Búsqueda y filtro de estado son locales
// (sobre los datos ya cargados, sin volver a pedir a la API) — el único filtro que
// dispara una consulta nueva es el rango de fechas, en la página. Paginado en cliente
// (Pagination 02 - Premium Ribbon de ShadcnSpace, 50 por página) y con selección
// múltiple para cambiar el estado de varios lotes a la vez.
//
// Mismo tratamiento visual que hierarchical-table.tsx (/compras) aunque la estructura
// sea distinta (plana aquí, árbol allí) — Card con cabecera, fondo bg-muted/40 en la
// cabecera de columnas, alto de fila h-12, celdas px-4, borde border-border/60. Petición
// explícita: que se "parezcan" en colores/tamaños/componentes compartidos aunque el
// contenido de cada tabla sea distinto.
import { useEffect, useMemo, useState } from "react";
import { SearchX, Loader2, CircleIcon } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Button } from "@/components/nova/ui/button";
import PremiumRibbon from "@/components/shadcn-space/pagination/pagination-02";
import { cn } from "@/lib/utils";

export const ESTADOS = ["pendiente", "enviado", "completado"] as const;
export type Estado = typeof ESTADOS[number];

export interface Muestra {
  articulo: string;
  descripcion: string;
  marca: string;
  lote: string;
  estado: Estado;
  observacion: string;
}

// Exportados para que page.tsx use el mismo texto/color en los KPIs y en los toasts
// (petición explícita: primera letra en mayúscula, y el color del estado en el KPI).
export const ESTADO_LABEL: Record<Estado, string> = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  completado: "Completado",
};

// Colores fijos (enum cerrado de 3 estados, a diferencia de la familia/marca de otras
// tablas Nova que usan una paleta por hash porque la lista no es cerrada). Formato
// "text-x fill-x" para el CircleIcon del Select con estado (ShadcnSpace Select 03).
const ESTADO_DOT_COLOR: Record<Estado, string> = {
  pendiente: "text-amber-500 fill-amber-500",
  enviado: "text-sky-500 fill-sky-500",
  completado: "text-teal-600 fill-teal-600",
};

// Solo el color de texto, para el número grande de los KPIs (page.tsx).
export const ESTADO_TEXT_COLOR: Record<Estado, string> = {
  pendiente: "text-amber-600",
  enviado: "text-sky-500",
  completado: "text-teal-600",
};

const PAGE_SIZE = 50;

function claveDe(m: { articulo: string; lote: string }) {
  return `${m.articulo}::${m.lote}`;
}

export default function MuestrasTable({
  data,
  onUpdate,
  onBulkUpdate,
}: {
  data: Muestra[];
  onUpdate: (articulo: string, lote: string, patch: { estado?: Estado; observacion?: string }) => void;
  onBulkUpdate: (items: { articulo: string; lote: string }[], estado: Estado) => Promise<void>;
}) {
  const [busqueda, setBusqueda] = useState("");
  // Por defecto solo Pendientes — petición explícita, el usuario cambia el filtro si quiere ver el resto.
  const [filtroEstado, setFiltroEstado] = useState<Estado | "todos">("pendiente");
  const [pagina, setPagina] = useState(1);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [bulkEstado, setBulkEstado] = useState<Estado>("enviado");
  const [aplicandoBulk, setAplicandoBulk] = useState(false);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return data.filter((m) => {
      if (filtroEstado !== "todos" && m.estado !== filtroEstado) return false;
      if (!q) return true;
      return (
        m.articulo.toLowerCase().includes(q) ||
        m.lote.toLowerCase().includes(q) ||
        m.descripcion.toLowerCase().includes(q) ||
        m.marca.toLowerCase().includes(q)
      );
    });
  }, [data, busqueda, filtroEstado]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  useEffect(() => { setPagina(1); }, [busqueda, filtroEstado]);
  useEffect(() => { if (pagina > totalPaginas) setPagina(totalPaginas); }, [pagina, totalPaginas]);

  const paginadas = useMemo(
    () => filtradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE),
    [filtradas, pagina]
  );

  const clavesPagina = useMemo(() => paginadas.map(claveDe), [paginadas]);
  const clavesFiltradas = useMemo(() => filtradas.map(claveDe), [filtradas]);
  const todaPaginaSeleccionada = clavesPagina.length > 0 && clavesPagina.every((k) => seleccion.has(k));
  const algunaPaginaSeleccionada = clavesPagina.some((k) => seleccion.has(k));
  const todoFiltradoSeleccionado = clavesFiltradas.length > 0 && clavesFiltradas.every((k) => seleccion.has(k));

  const toggleFila = (m: Muestra) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      const k = claveDe(m);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleCabecera = () => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (todaPaginaSeleccionada) {
        clavesPagina.forEach((k) => next.delete(k));
      } else {
        clavesPagina.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const seleccionarTodoFiltrado = () => setSeleccion(new Set(clavesFiltradas));
  const limpiarSeleccion = () => setSeleccion(new Set());

  const aplicarBulk = async () => {
    const items = filtradas.filter((m) => seleccion.has(claveDe(m))).map((m) => ({ articulo: m.articulo, lote: m.lote }));
    if (items.length === 0) return;
    setAplicandoBulk(true);
    try {
      await onBulkUpdate(items, bulkEstado);
      limpiarSeleccion();
    } finally {
      setAplicandoBulk(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-0">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6">
          <div>
            <CardTitle className="text-lg font-medium text-foreground">Lotes</CardTitle>
            <p className="text-sm font-normal text-muted-foreground">
              {filtradas.length} de {data.length} lote{data.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Buscar por artículo, lote, descripción o marca…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-8 w-64"
            />
            <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as Estado | "todos")}>
              <SelectTrigger size="sm" className="w-40">
                {filtroEstado !== "todos" && <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[filtroEstado])} />}
                <SelectValue>{(v: Estado | "todos") => (v === "todos" ? "Todos los estados" : ESTADO_LABEL[v])}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="todos">Todos los estados</SelectItem>
                {ESTADOS.map((e) => (
                  <SelectItem key={e} value={e}>
                    <div className="flex items-center gap-2">
                      <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[e])} />
                      <span>{ESTADO_LABEL[e]}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        {seleccion.size > 0 && (
          <div className="mx-6 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">{seleccion.size} seleccionado{seleccion.size === 1 ? "" : "s"}</span>
            <Select value={bulkEstado} onValueChange={(v) => setBulkEstado(v as Estado)}>
              <SelectTrigger size="sm" className="w-40">
                <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[bulkEstado])} />
                <SelectValue>{(v: Estado) => ESTADO_LABEL[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                {ESTADOS.map((e) => (
                  <SelectItem key={e} value={e}>
                    <div className="flex items-center gap-2">
                      <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[e])} />
                      <span>{ESTADO_LABEL[e]}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={aplicarBulk} disabled={aplicandoBulk} className="gap-1.5">
              {aplicandoBulk && <Loader2 size={14} className="animate-spin" />}
              Aplicar a {seleccion.size}
            </Button>
            <Button size="sm" variant="ghost" onClick={limpiarSeleccion}>Cancelar selección</Button>
          </div>
        )}

        {todaPaginaSeleccionada && !todoFiltradoSeleccionado && clavesFiltradas.length > clavesPagina.length && (
          <div className="mx-6 mb-2 text-xs text-muted-foreground">
            Seleccionados los {clavesPagina.length} lotes de esta página.{" "}
            <button onClick={seleccionarTodoFiltrado} className="text-primary underline underline-offset-2">
              Seleccionar los {clavesFiltradas.length} lotes filtrados
            </button>
          </div>
        )}

        {filtradas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-border py-16 text-muted-foreground">
            <SearchX size={28} />
            <p className="text-sm">Sin lotes que coincidan con el filtro.</p>
          </div>
        ) : (
          <CardContent className="overflow-hidden rounded-b-xl border-t border-border p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60">
                    <TableHead className="h-9 w-9 bg-muted/40 px-4">
                      <Checkbox
                        checked={todaPaginaSeleccionada}
                        indeterminate={!todaPaginaSeleccionada && algunaPaginaSeleccionada}
                        onCheckedChange={toggleCabecera}
                      />
                    </TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Artículo</TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Descripción</TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Marca</TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Lote</TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Estado</TableHead>
                    <TableHead className="h-9 w-64 bg-muted/40 px-4 text-muted-foreground">Observación</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginadas.map((m) => (
                    <TableRow key={claveDe(m)} className="h-12 border-border/60">
                      <TableCell className="h-12 px-4 py-0 align-middle">
                        <Checkbox checked={seleccion.has(claveDe(m))} onCheckedChange={() => toggleFila(m)} />
                      </TableCell>
                      <TableCell className="h-12 px-4 py-0 align-middle font-medium text-foreground">{m.articulo}</TableCell>
                      <TableCell className="h-12 max-w-64 truncate px-4 py-0 align-middle" title={m.descripcion}>{m.descripcion || "—"}</TableCell>
                      <TableCell className="h-12 px-4 py-0 align-middle text-muted-foreground">{m.marca || "—"}</TableCell>
                      <TableCell className="h-12 px-4 py-0 align-middle text-muted-foreground">{m.lote}</TableCell>
                      <TableCell className="h-12 px-4 py-0 align-middle">
                        <Select value={m.estado} onValueChange={(v) => onUpdate(m.articulo, m.lote, { estado: v as Estado })}>
                          <SelectTrigger size="sm" className="w-32">
                            <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[m.estado])} />
                            <SelectValue>{(v: Estado) => ESTADO_LABEL[v]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="start" alignItemWithTrigger={false}>
                            {ESTADOS.map((e) => (
                              <SelectItem key={e} value={e}>
                                <div className="flex items-center gap-2">
                                  <CircleIcon className={cn("size-2", ESTADO_DOT_COLOR[e])} />
                                  <span>{ESTADO_LABEL[e]}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="h-12 whitespace-normal px-4 py-0 align-middle">
                        <Input
                          key={`${claveDe(m)}::${m.observacion}`}
                          defaultValue={m.observacion}
                          placeholder="Sin observaciones"
                          className="h-7 text-xs"
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next !== m.observacion) onUpdate(m.articulo, m.lote, { observacion: next });
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>

      {filtradas.length > 0 && totalPaginas > 1 && (
        <PremiumRibbon page={pagina} totalPages={totalPaginas} onPageChange={setPagina} />
      )}
    </div>
  );
}
