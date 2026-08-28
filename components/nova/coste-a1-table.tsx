"use client";

// Tabla de coste A1 y despiece — árbol real de profundidad variable (subRows de
// TanStack), igual patrón que hierarchical-table.tsx (compras) y
// mrp-materials-table.tsx: fila completa clicable para desplegar, indentación por
// profundidad, sin tabla anidada en una celda. La diferencia con esas dos es que
// aquí la API ya devuelve el árbol completo anidado (children recursivos, cualquier
// profundidad) — toTree() solo traduce la forma, no reconstruye niveles fijos.
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, ChevronDown, ChevronRight, ListTree, SearchX } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Button } from "@/components/nova/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/nova/ui/dialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/nova/ui/card";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/nova/ui/breadcrumb";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { cn } from "@/lib/utils";
import type { DespieceNode } from "@/app/api/coste-a1/route";

export type { DespieceNode };

interface TreeRow {
  id: string;
  codigo: string;
  concepto: string;
  tipo: string;
  familia: string;
  familiaDescripcion: string;
  costeA1: number | null;
  cantidad: number;
  um: string;
  esRaiz: boolean;
  // Solo se rellena en la fila raíz — ¿hay algún descuadre local en cualquier punto
  // del árbol COMPLETO (sin podar), no solo en lo que enseña el informe (11/12)?
  tieneProblema?: boolean;
  subRows?: TreeRow[];
}

const TIPO_COLOR: Record<string, string> = {
  Terminado: "bg-sky-400/10 text-sky-500",
  Semiterminado: "bg-violet-400/10 text-violet-500",
  Semielaborado: "bg-amber-400/10 text-amber-600",
  Comercializado: "bg-teal-400/10 text-teal-500",
  "Materia prima": "bg-muted text-muted-foreground",
};

// Paleta fija por índice (hash del código de familia) — lista abierta, no se puede
// tener un color por código a mano. Mismo patrón que mrp-materials-table.tsx.
const PALETA_FAMILIA = [
  "bg-sky-400/10 text-sky-500",
  "bg-amber-400/10 text-amber-600",
  "bg-teal-400/10 text-teal-500",
  "bg-violet-400/10 text-violet-500",
  "bg-rose-400/10 text-rose-500",
  "bg-lime-400/10 text-lime-600",
  "bg-cyan-400/10 text-cyan-500",
  "bg-orange-400/10 text-orange-500",
];
function colorFamilia(familia: string): string {
  let hash = 0;
  for (let i = 0; i < familia.length; i++) hash = (hash * 31 + familia.charCodeAt(i)) >>> 0;
  return PALETA_FAMILIA[hash % PALETA_FAMILIA.length];
}

function numeroEs(v: number): string {
  return v.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}
// El coste sale de dividir IECSL entre 10000 (F30026) — hasta 4 decimales con
// significado real. Redondear a 2 como el resto de importes de la app perdía
// precisión real (ej. 0,6454 € se veía como 0,65 €), así que aquí se muestran
// todos los decimales que tenga, no solo 2.
function euros(v: number): string {
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

// El informe (tabla principal) solo debe enseñar niveles "11"/"12" — nada de
// envases/etiquetas/materia prima (10, 13, 14...). Poda recursiva por TIPO, no por
// profundidad: una cadena 12 → 11 → 11 sigue viéndose entera, pero en cuanto un nodo
// no es 11/12 se corta ahí (y con él, todo lo que cuelgue debajo).
function podar1112(n: DespieceNode): DespieceNode {
  return {
    ...n,
    children: n.children
      .filter((c) => c.tipo === "Semiterminado" || c.tipo === "Terminado")
      .map(podar1112),
  };
}

// Verificación GLOBAL: recompone el coste de "una unidad" del final sumando sus
// hijos (cantidad × coste de cada hijo, recursivo hasta la materia prima) — es la
// operación inversa a como JDE calcula su propio coste A1 en F30026, así que debería
// coincidir. Un componente sin coste A1 cuenta como 0 (no bloquea el cálculo, se
// avisa aparte de cuáles son) — pedido explícito: "la suma se puede hacer igual y
// mostrar si hay diferencias, aunque falte algún coste".
function costeDesdeHojas(n: DespieceNode): { suma: number; faltantes: DespieceNode[] } {
  if (n.children.length === 0) {
    return n.costeA1 != null ? { suma: n.costeA1, faltantes: [] } : { suma: 0, faltantes: [n] };
  }
  let suma = 0;
  let faltantes: DespieceNode[] = [];
  for (const c of n.children) {
    const hijo = costeDesdeHojas(c);
    suma += c.cantidad * hijo.suma;
    faltantes = faltantes.concat(hijo.faltantes);
  }
  return { suma, faltantes };
}

// Tolerancia de redondeo compartida — el coste declarado en F30026 y la suma
// recalculada no tienen por qué llevar exactamente los mismos decimales.
const TOLERANCIA = 0.01;

// ¿Hay algún descuadre LOCAL en cualquier punto de este subárbol (el propio nodo
// o cualquier descendiente)? No basta con mirar el total del nodo (la comprobación
// global de costeDesdeHojas): dos descuadres internos podrían compensarse por
// casualidad y la suma final "cuadrar" sin que nada esté realmente bien — pedido
// explícito: "puede haber algo dentro mal pero que la suma para él coincida por
// algún motivo extraño". Por eso se comprueba el nivel local de CADA nodo con
// hijos del subárbol, no solo el nodo raíz.
function tieneProblemaInterno(n: DespieceNode): boolean {
  if (n.children.length > 0) {
    const sumaDirecta = n.children.reduce((s, c) => s + c.cantidad * (c.costeA1 ?? 0), 0);
    if (n.costeA1 != null && Math.abs(sumaDirecta - n.costeA1) >= TOLERANCIA) return true;
  }
  return n.children.some(tieneProblemaInterno);
}

function Descuadre({ valor, tono = "text" }: { valor: number; tono?: "text" | "xs" }) {
  const cuadra = Math.abs(valor) < TOLERANCIA;
  const cls = tono === "xs" ? "text-xs" : "text-sm";
  if (cuadra) {
    return <span className={cn("flex items-center gap-1 text-[color:var(--color-success)]", cls)}><CircleCheck size={tono === "xs" ? 12 : 14} /> Coincide</span>;
  }
  return (
    <span className={cn("flex items-center gap-1 text-[color:var(--color-destructive)]", cls)}>
      <CircleAlert size={tono === "xs" ? 12 : 14} />
      {valor > 0 ? "+" : ""}{euros(valor)}
    </span>
  );
}

// Navegación por niveles (drill-down) — nada de scroll ni vertical ni horizontal,
// pedido explícito: solo se pinta UNA tarjeta a la vez (el nodo "actual"), con su
// mini-tabla de componentes DIRECTOS. Pulsar un componente que a su vez tenga su
// propio desglose (children.length > 0) sustituye la tarjeta por la suya — el
// Breadcrumb de arriba hace de "volver atrás" (pulsar un nivel anterior recorta la
// ruta a ese punto). Los componentes sin desglose propio (materia prima) no son
// clicables, no tienen a dónde bajar.
function TarjetaActual({
  node,
  ruta,
  onEntrar,
  onIrA,
}: {
  node: DespieceNode;
  ruta: DespieceNode[];
  onEntrar: (hijo: DespieceNode) => void;
  onIrA: (indice: number) => void;
}) {
  const sumaDirecta = node.children.reduce((s, c) => s + c.cantidad * (c.costeA1 ?? 0), 0);
  const faltanDirectos = node.children.filter((c) => c.costeA1 == null);
  const cadena = [...ruta, node];

  return (
    <Card className="gap-3 py-3">
      <CardHeader className="gap-1.5 border-b [.border-b]:pb-3">
        {ruta.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList className="text-xs">
              {cadena.map((a, i) => {
                const esUltimo = i === cadena.length - 1;
                return (
                  <Fragment key={a.codigo}>
                    <BreadcrumbItem className="min-w-0">
                      {esUltimo ? (
                        <BreadcrumbPage className="truncate text-xs">{a.descripcion || a.codigo}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          render={<button type="button" onClick={() => onIrA(i)} />}
                          className="truncate"
                        >
                          {a.descripcion || a.codigo}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!esUltimo && <BreadcrumbSeparator />}
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="truncate">{node.descripcion || "(sin descripción)"}</CardTitle>
            <Badge variant="outline" className="shrink-0 font-normal">{node.tipo}</Badge>
          </div>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.codigo}</span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* Sin alto fijo: la tarjeta se ajusta al número de componentes de cada
            nodo (pedido explícito, "que no sea tamaño fijo"). Sigue sin haber
            scroll en el caso normal porque solo se pinta UN nodo a la vez. */}
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="h-7 px-3 text-xs text-muted-foreground">Componente</TableHead>
                <TableHead className="h-7 px-3 text-right text-xs text-muted-foreground">Cantidad</TableHead>
                <TableHead className="h-7 px-3 text-right text-xs text-muted-foreground">Coste</TableHead>
                <TableHead className="h-7 px-3 text-right text-xs text-muted-foreground">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {node.children.map((c, i) => {
                const drilable = c.children.length > 0;
                // Pinta la fila según si HAY o NO algún descuadre local en cualquier
                // punto del subárbol de este componente (no solo su propio total) —
                // ver tieneProblemaInterno(). Solo aplica a filas con desglose propio:
                // una hoja de materia prima no tiene nada "de dentro" que comprobar.
                const problema = drilable ? tieneProblemaInterno(c) : null;
                return (
                  <TableRow
                    key={`${c.codigo}-${i}`}
                    onClick={drilable ? () => onEntrar(c) : undefined}
                    className={cn(
                      drilable && "cursor-pointer",
                      problema === true && "bg-[color:var(--color-destructive)]/8 hover:bg-[color:var(--color-destructive)]/12",
                      problema === false && "bg-[color:var(--color-success)]/8 hover:bg-[color:var(--color-success)]/12"
                    )}
                  >
                    <TableCell className="px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        {drilable && <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
                        <span className={cn("truncate text-foreground", !drilable && "pl-[19px]")}>{c.descripcion || "(sin descripción)"}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{c.tipo}</span>
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {numeroEs(c.cantidad)} <span className="text-xs">{c.um}</span>
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {c.costeA1 != null ? euros(c.costeA1) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-1.5 text-right font-medium tabular-nums text-foreground">
                      {euros(c.cantidad * (c.costeA1 ?? 0))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Declarado <span className="font-semibold text-foreground">{node.costeA1 != null ? euros(node.costeA1) : "—"}</span>
            {" · "}Suma <span className="font-semibold text-foreground">{euros(sumaDirecta)}</span>
            {faltanDirectos.length > 0 && <span className="ml-1 text-amber-600">· {faltanDirectos.length} sin coste</span>}
          </span>
          {node.costeA1 != null ? <Descuadre valor={sumaDirecta - node.costeA1} /> : <span className="text-xs text-muted-foreground">Sin coste propio</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function toTreeRow(n: DespieceNode, id: string, esRaiz: boolean, tieneProblema?: boolean): TreeRow {
  return {
    id,
    codigo: n.codigo,
    concepto: n.descripcion || "(sin descripción)",
    tipo: n.tipo,
    familia: n.familia,
    familiaDescripcion: n.familiaDescripcion,
    costeA1: n.costeA1,
    cantidad: n.cantidad,
    um: n.um,
    esRaiz,
    tieneProblema,
    subRows: n.children.length > 0 ? n.children.map((c, i) => toTreeRow(c, `${id}::${i}::${c.codigo}`, false)) : undefined,
  };
}

type SortBy = "coste" | "nombre";

function SortableHeaderLabel({ label, active, dir, align = "left" }: { label: string; active: boolean; dir: "asc" | "desc"; align?: "left" | "right" }) {
  return (
    <span className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
      {align === "right" && label}
      {active ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowDown size={12} className="opacity-30" />}
      {align === "left" && label}
    </span>
  );
}

const columnHelper = createColumnHelper<TreeRow>();

function buildColumns(sortBy: SortBy, sortDir: "asc" | "desc", onVerDespiece: (codigo: string) => void) {
  return [
    columnHelper.display({
      id: "concepto",
      header: () => <span>Artículo</span>,
      cell: ({ row }) => {
        const r = row.original;
        const contenido = (
          <span className="flex flex-col">
            <span className="flex items-center gap-2">
              <span className={cn("font-medium text-foreground", r.esRaiz && "font-semibold")}>{r.concepto}</span>
              <Badge className={cn("font-normal", TIPO_COLOR[r.tipo])}>{r.tipo}</Badge>
            </span>
            <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span>
          </span>
        );
        return (
          <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 22 }}>
            {r.subRows && r.subRows.length > 0 ? (
              <span className="flex items-center gap-2">
                {row.getIsExpanded() ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                {contenido}
              </span>
            ) : (
              <span className="pl-[22px]">{contenido}</span>
            )}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "familia",
      header: () => <span>Familia</span>,
      cell: ({ row }) =>
        row.original.familia ? (
          <Badge className={colorFamilia(row.original.familia)}>{row.original.familiaDescripcion}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    }),
    columnHelper.display({
      id: "coste",
      header: () => <SortableHeaderLabel label="Coste A1" active={sortBy === "coste"} dir={sortDir} align="right" />,
      cell: ({ row }) => (
        <span className={cn("block text-right tabular-nums", row.original.esRaiz ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {row.original.costeA1 != null ? euros(row.original.costeA1) : "—"}
        </span>
      ),
    }),
    columnHelper.display({
      id: "acciones",
      header: () => null,
      cell: ({ row }) =>
        row.original.esRaiz ? (
          <div className="flex items-center justify-end gap-2">
            {row.original.tieneProblema && (
              <CircleAlert
                size={15}
                className="shrink-0 text-[color:var(--color-destructive)]"
                aria-label="Hay un descuadre en algún punto del despiece completo"
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              // Sin esto, el clic también burbujea al onClick de la <TableRow> y
              // pliega/despliega la fila a la vez que abre el desglose completo.
              onClick={(e) => { e.stopPropagation(); onVerDespiece(row.original.codigo); }}
            >
              <ListTree size={14} />
              Ver despiece completo
            </Button>
          </div>
        ) : null,
    }),
  ];
}

export default function CosteA1Table({ data }: { data: DespieceNode[] }) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  const [sortBy, setSortBy] = useState<SortBy>("coste");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Código del final cuyo despiece completo (sin podar) se ve en el modal — no el
  // nodo en sí, así siempre lee el dato vivo de `data` (útil tras un Recalcular).
  const [verDespieceCodigo, setVerDespieceCodigo] = useState<string | null>(null);
  const verDespieceNode = useMemo(
    () => (verDespieceCodigo ? data.find((n) => n.codigo === verDespieceCodigo) ?? null : null),
    [data, verDespieceCodigo]
  );
  // Ruta de navegación DENTRO del modal (drill-down, sin scroll): [raíz, ...pasos].
  // El último elemento es el nodo que se está viendo ahora mismo. Se reinicia cada
  // vez que se abre un final distinto (o el mismo tras un Recalcular).
  const [caminoActual, setCaminoActual] = useState<DespieceNode[]>([]);
  useEffect(() => {
    setCaminoActual(verDespieceNode ? [verDespieceNode] : []);
  }, [verDespieceCodigo, verDespieceNode]);
  const nodoActual = caminoActual[caminoActual.length - 1] ?? null;
  const rutaAncestros = caminoActual.slice(0, -1);

  const familias = useMemo(() => {
    const map = new Map<string, string>();
    data.forEach((n) => { if (n.familia) map.set(n.familia, n.familiaDescripcion || n.familia); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((n) => {
      const matchQ = !q || n.codigo.toLowerCase().includes(q) || n.descripcion.toLowerCase().includes(q);
      const matchFamilia = familia === "__todas__" || n.familia === familia;
      return matchQ && matchFamilia;
    });
  }, [data, search, familia]);

  // Orden manual del nivel RAÍZ únicamente — getSortedRowModel de TanStack también
  // reordenaría los hijos de cada árbol por el mismo criterio, descolocando el orden
  // por cantidad descendente que ya viene calculado desde la API.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = sortBy === "coste"
        ? (a.costeA1 ?? -1) - (b.costeA1 ?? -1)
        : (a.descripcion || a.codigo).localeCompare(b.descripcion || b.codigo);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir(col === "coste" ? "desc" : "asc"); }
  };

  // Informe (tabla principal): podado a solo 11/12 — ver podar1112(). El desglose
  // completo (10/13/14 incluidos) vive aparte, en el modal "Ver despiece completo".
  // tieneProblemaInterno() se calcula SOBRE EL ÁRBOL SIN PODAR (n, no podar1112(n))
  // — un descuadre puede estar escondido en un nivel que el informe no enseña
  // (10/13/14), y aun así hay que avisar de que algo no cuadra dentro.
  const treeData = useMemo(
    () => sorted.map((n, i) => toTreeRow(podar1112(n), `${i}::${n.codigo}`, true, tieneProblemaInterno(n))),
    [sorted]
  );
  const columns = useMemo(() => buildColumns(sortBy, sortDir, setVerDespieceCodigo), [sortBy, sortDir]);

  const table = useReactTable({
    data: treeData,
    columns,
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const verificacion = verDespieceNode ? costeDesdeHojas(verDespieceNode) : null;
  const descuadreGlobal = verDespieceNode && verificacion ? verificacion.suma - (verDespieceNode.costeA1 ?? 0) : null;

  return (
    <>
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar por código o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Select value={familia} onValueChange={(v) => setFamilia(v ?? "__todas__")}>
          <SelectTrigger className="w-44">
            <SelectValue>
              {(v: string) => (v === "__todas__" ? "Todas las familias" : familias.find(([code]) => code === v)?.[1] || v)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas__">Todas las familias</SelectItem>
            {familias.map(([code, desc]) => (
              <SelectItem key={code} value={code}>{desc}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} de {data.length} artículos finales</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40">
                  {hg.headers.map((h) => {
                    const sortable = h.column.id === "coste";
                    return (
                      <TableHead
                        key={h.id}
                        className={cn("h-9 px-4 text-muted-foreground", sortable && "cursor-pointer select-none")}
                        onClick={sortable ? () => toggleSort(h.column.id as SortBy) : undefined}
                      >
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={row.getCanExpand() ? () => row.toggleExpanded() : undefined}
                  className={cn(
                    !row.original.esRaiz && "bg-muted/20 hover:bg-muted/30",
                    row.getCanExpand() && "cursor-pointer"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="h-12 px-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <SearchX size={28} className="text-muted-foreground" />
                      <p className="font-medium text-foreground">Sin resultados</p>
                      <p className="text-sm text-muted-foreground">No hay artículos finales para este filtro.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>

    <Dialog open={verDespieceNode != null} onOpenChange={(open) => { if (!open) setVerDespieceCodigo(null); }}>
      {/* Sin max-h/overflow: pedido explícito, nada de scroll ni vertical ni
          horizontal — por eso el desglose de abajo navega de uno en uno
          (drill-down) en vez de mostrar el árbol entero de golpe, y todo el
          espaciado va más ajustado que en el resto de la app. Anclado arriba
          (top-8, no centrado verticalmente): centrado de verdad, con contenido
          más alto que el viewport, el título quedaba fuera de la pantalla nada
          más abrirlo — con esto al menos la cabecera siempre se ve entera. */}
      <DialogContent className="top-8 w-[92vw] max-w-3xl translate-y-0 gap-0 p-0 sm:max-w-3xl">
        {verDespieceNode && verificacion && nodoActual && (
          <>
            <DialogHeader className="border-b border-border p-5 pb-3">
              <DialogTitle className="text-lg">{verDespieceNode.descripcion || "(sin descripción)"}</DialogTitle>
              <DialogDescription className="font-mono text-xs">{verDespieceNode.codigo}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5 border-b border-border bg-muted/30 p-5">
              <p className="text-xs font-medium text-muted-foreground">Comprobación global</p>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Declarado <span className="font-semibold tabular-nums text-foreground">{verDespieceNode.costeA1 != null ? euros(verDespieceNode.costeA1) : "—"}</span>
                  {" · "}
                  Suma <span className="font-semibold tabular-nums text-foreground">{euros(verificacion.suma)}</span>
                  {verificacion.faltantes.length > 0 && <span className="ml-1 text-amber-600">· {verificacion.faltantes.length} sin coste</span>}
                </span>
                {verDespieceNode.costeA1 != null && <Descuadre valor={descuadreGlobal ?? 0} />}
              </div>
            </div>

            <div className="p-5">
              <TarjetaActual
                node={nodoActual}
                ruta={rutaAncestros}
                onEntrar={(hijo) => setCaminoActual((c) => [...c, hijo])}
                onIrA={(indice) => setCaminoActual((c) => c.slice(0, indice + 1))}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
