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
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, SearchX } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
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
function euros(v: number): string {
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
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

function buildColumns(sortBy: SortBy, sortDir: "asc" | "desc") {
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
  ];
}

export default function CosteA1Table({ data }: { data: DespieceNode[] }) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  const [sortBy, setSortBy] = useState<SortBy>("coste");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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

  const treeData = useMemo(() => sorted.map((n, i) => toTreeRow(n, `${i}::${n.codigo}`, true)), [sorted]);
  const columns = useMemo(() => buildColumns(sortBy, sortDir), [sortBy, sortDir]);

  const table = useReactTable({
    data: treeData,
    columns,
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
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
        {/* max-h + overflow propios (no solo el overflow-x-auto interno de <Table>):
            con 200+ artículos finales la página entera se volvía kilométrica — mejor
            un scroll interno con cabecera fija (sticky), como cualquier tabla de datos
            larga, que obligar a hacer scroll de toda la pantalla para ver la última fila. */}
        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
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
  );
}
