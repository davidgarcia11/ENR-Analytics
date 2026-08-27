"use client";

// Tabla de coste A1 y despiece — árbol real de profundidad variable (subRows de
// TanStack), igual patrón que hierarchical-table.tsx (compras) y
// mrp-materials-table.tsx: fila completa clicable para desplegar, indentación por
// profundidad, sin tabla anidada en una celda. La diferencia con esas dos es que
// aquí la API ya devuelve el árbol completo anidado (children recursivos, cualquier
// profundidad) — toTree() solo traduce la forma, no reconstruye niveles fijos.
import { useMemo, useState } from "react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/nova/ui/sheet";
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

// Verificación: recompone el coste de "una unidad" de un nodo sumando sus hijos
// (cantidad × coste de cada hijo, recursivo hasta la materia prima) — es la
// operación inversa a como JDE calcula su propio coste A1 en F30026, así que debería
// coincidir. `completo` es false si falta el coste A1 de algún componente por el
// camino (la suma parcial no es de fiar y hay que decirlo, no solo mostrar un número).
function costeAcumulado(n: DespieceNode): { suma: number; completo: boolean } {
  if (n.children.length === 0) {
    return n.costeA1 != null ? { suma: n.costeA1, completo: true } : { suma: 0, completo: false };
  }
  let suma = 0;
  let completo = true;
  for (const c of n.children) {
    const hijo = costeAcumulado(c);
    suma += c.cantidad * hijo.suma;
    completo = completo && hijo.completo;
  }
  return { suma, completo };
}

// Fila del despiece COMPLETO dentro del Sheet — lista recursiva simple (no una
// tabla TanStack aparte): aquí no hace falta ordenar/filtrar, solo leer de arriba
// abajo un único árbol ya acotado a un final concreto.
function ArbolCompleto({ node, profundidad }: { node: DespieceNode; profundidad: number }) {
  return (
    <div>
      <div
        className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5"
        style={{ paddingLeft: profundidad * 16 }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-foreground", profundidad === 0 ? "font-semibold" : "font-medium")}>{node.descripcion || "(sin descripción)"}</span>
          <Badge className={cn("shrink-0 font-normal", TIPO_COLOR[node.tipo])}>{node.tipo}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          {profundidad > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {numeroEs(node.cantidad)} <span className="text-xs">{node.um}</span>
            </span>
          )}
          <span className="w-20 text-right tabular-nums">{node.costeA1 != null ? euros(node.costeA1) : "—"}</span>
        </div>
      </div>
      {node.children.map((c, i) => (
        <ArbolCompleto key={`${c.codigo}-${i}`} node={c} profundidad={profundidad + 1} />
      ))}
    </div>
  );
}

function toTreeRow(n: DespieceNode, id: string, esRaiz: boolean): TreeRow {
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
      id: "cantidad",
      header: () => <span className="block text-right">Cantidad</span>,
      cell: ({ row }) =>
        row.original.esRaiz ? (
          <span className="block text-right text-muted-foreground">—</span>
        ) : (
          <span className="block text-right tabular-nums text-muted-foreground">
            {numeroEs(row.original.cantidad)} <span className="text-xs">{row.original.um}</span>
          </span>
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
        ) : null,
    }),
  ];
}

export default function CosteA1Table({ data }: { data: DespieceNode[] }) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  const [sortBy, setSortBy] = useState<SortBy>("coste");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Código del final cuyo despiece completo (sin podar) se ve en el Sheet — no el
  // nodo en sí, así siempre lee el dato vivo de `data` (útil tras un Recalcular).
  const [verDespieceCodigo, setVerDespieceCodigo] = useState<string | null>(null);
  const verDespieceNode = useMemo(
    () => (verDespieceCodigo ? data.find((n) => n.codigo === verDespieceCodigo) ?? null : null),
    [data, verDespieceCodigo]
  );

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
  // completo (10/13/14 incluidos) vive aparte, en el Sheet "Ver despiece completo".
  const treeData = useMemo(
    () => sorted.map((n, i) => toTreeRow(podar1112(n), `${i}::${n.codigo}`, true)),
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

  const verificacion = verDespieceNode ? costeAcumulado(verDespieceNode) : null;
  const descuadre = verDespieceNode && verificacion ? verificacion.suma - (verDespieceNode.costeA1 ?? 0) : null;
  // Tolerancia de redondeo (el coste declarado en F30026 y la suma recalculada no
  // tienen por qué llevar exactamente los mismos decimales de precisión).
  const cuadra = descuadre != null && Math.abs(descuadre) < 0.01;

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
                  <TableCell colSpan={5}>
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

    <Sheet open={verDespieceNode != null} onOpenChange={(open) => { if (!open) setVerDespieceCodigo(null); }}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        {verDespieceNode && verificacion && (
          <>
            <SheetHeader className="border-b border-border pb-3">
              <SheetTitle>{verDespieceNode.descripcion || "(sin descripción)"}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{verDespieceNode.codigo}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-2 border-b border-border p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Coste A1 declarado (F30026)</span>
                <span className="font-semibold tabular-nums text-foreground">{verDespieceNode.costeA1 != null ? euros(verDespieceNode.costeA1) : "—"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Suma de componentes (hasta materia prima)</span>
                <span className="font-semibold tabular-nums text-foreground">{euros(verificacion.suma)}</span>
              </div>
              {!verificacion.completo ? (
                <div className="flex items-center gap-1.5 text-sm text-amber-600">
                  <CircleAlert size={14} />
                  Cálculo incompleto — algún componente no tiene coste A1 en F30026, la suma puede quedarse corta.
                </div>
              ) : cuadra ? (
                <div className="flex items-center gap-1.5 text-sm text-[color:var(--color-success)]">
                  <CircleCheck size={14} />
                  Coincide con el coste declarado.
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-sm text-[color:var(--color-destructive)]">
                  <CircleAlert size={14} />
                  Descuadre de {euros(Math.abs(descuadre ?? 0))} {(descuadre ?? 0) > 0 ? "por encima" : "por debajo"} del coste declarado.
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4">
              <ArbolCompleto node={verDespieceNode} profundidad={0} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}
