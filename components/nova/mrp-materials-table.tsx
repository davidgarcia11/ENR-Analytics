"use client";

// Tabla de materiales a comprar — árbol real (subRows de TanStack), no una tabla
// anidada dentro de una celda: mismo patrón que components/nova/hierarchical-table.tsx
// de /compras (chevron + indentación por profundidad, filas del mismo árbol, no un
// <Table> separado embebido). Se cambió de un enfoque tipo datatable-12 (fila
// expandible con contenido anidado) a este por consistencia visual con el resto del
// sistema Nova — ver ClickUp #869eq7nqd.
// El desglose por mes (subRows) solo se genera si hay más de un mes en el rango
// filtrado — con uno solo repetiría el mismo número que ya se ve en la fila padre.
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

export interface Contribucion {
  articuloPadre: string;
  descripcionPadre: string;
  mes: string;
  sortKey: string;
  cantidad: number;
}
export interface Material {
  codigo: string;
  descripcion: string;
  familia: string;
  familiaDescripcion: string;
  um: string;
  cantidad: number;
  contribuciones: Contribucion[];
}

interface TreeRow {
  id: string;
  tipo: "material" | "mes";
  concepto: string; // descripción (material) o etiqueta de mes
  codigo?: string;
  familia?: string;
  familiaDescripcion?: string;
  um: string;
  cantidad: number;
  subRows?: TreeRow[];
}

// Paleta fija por índice (hash del código de familia) — no conocemos de antemano
// cuántas familias distintas puede haber, así que no se puede tener un color por
// código a mano (igual que el badge de familia de compras usa colores fijos para
// una lista cerrada; aquí la lista no es cerrada).
const PALETA = [
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
  return PALETA[hash % PALETA.length];
}

function numeroEs(v: number): string {
  return v.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

// Agregado por MES del rango filtrado (sumando todos los artículos padre de ese
// mes) — es lo que compras quiere ver aquí ("¿cuándo hace falta?"), no la traza de
// qué producto lo consume (eso sigue en el Excel, hoja "Detalle por artículo").
export function agregarPorMes(contribuciones: Contribucion[]): { sortKey: string; mes: string; cantidad: number }[] {
  const porMes = new Map<string, { mes: string; cantidad: number }>();
  for (const c of contribuciones) {
    const acc = porMes.get(c.sortKey) ?? { mes: c.mes, cantidad: 0 };
    acc.cantidad += c.cantidad;
    porMes.set(c.sortKey, acc);
  }
  return Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sortKey, v]) => ({ sortKey, ...v }));
}

function toTree(materiales: Material[]): TreeRow[] {
  return materiales.map((m) => {
    const meses = agregarPorMes(m.contribuciones);
    return {
      id: m.codigo,
      tipo: "material",
      concepto: m.descripcion || "(sin descripción)",
      codigo: m.codigo,
      familia: m.familia,
      familiaDescripcion: m.familiaDescripcion,
      um: m.um,
      cantidad: m.cantidad,
      // Solo si hay más de un mes — con uno solo, expandir no aportaría nada nuevo.
      subRows: meses.length > 1
        ? meses.map((mm) => ({
            id: `${m.codigo}::${mm.sortKey}`,
            tipo: "mes" as const,
            concepto: mm.mes,
            um: m.um,
            cantidad: mm.cantidad,
          }))
        : undefined,
    };
  });
}

const columnHelper = createColumnHelper<TreeRow>();

type SortBy = "cantidad" | "familia";

// Cabecera ordenable — icono fijo (no ArrowUpDown neutro) porque el orden nunca
// está "sin aplicar": siempre hay una columna y dirección activas por defecto.
function SortableHeader({ label, active, dir, align = "left", onClick }: { label: string; active: boolean; dir: "asc" | "desc"; align?: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex items-center gap-1 text-muted-foreground hover:text-foreground", align === "right" && "ml-auto")}
    >
      {align === "right" && label}
      {active ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowDown size={12} className="opacity-30" />}
      {align === "left" && label}
    </button>
  );
}

function buildColumns(sortBy: SortBy, sortDir: "asc" | "desc", toggleSort: (col: SortBy) => void) {
  return [
  columnHelper.display({
    id: "material",
    header: () => <span>Material</span>,
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 22 }}>
          {r.subRows && r.subRows.length > 0 ? (
            // Sin onClick propio: el toggle vive en la fila entera (ver <TableRow>
            // más abajo), igual que hierarchical-table.tsx — para poder pulsar en
            // cualquier punto de la fila, no solo aquí.
            <span className="flex items-center gap-2">
              {row.getIsExpanded() ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
              <span className="flex flex-col">
                <span className="font-medium text-foreground">{r.concepto}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span>
              </span>
            </span>
          ) : r.tipo === "material" ? (
            <span className="flex flex-col pl-[22px]">
              <span className="font-medium text-foreground">{r.concepto}</span>
              <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 pl-[22px] text-muted-foreground">
              <span>·</span>
              <span>{r.concepto}</span>
            </span>
          )}
        </div>
      );
    },
  }),
  columnHelper.display({
    id: "familia",
    header: () => (
      <SortableHeader label="Familia" active={sortBy === "familia"} dir={sortDir} onClick={() => toggleSort("familia")} />
    ),
    cell: ({ row }) =>
      row.original.tipo === "material" && row.original.familia ? (
        <Badge className={colorFamilia(row.original.familia)}>{row.original.familiaDescripcion}</Badge>
      ) : null,
  }),
  columnHelper.display({
    id: "cantidad",
    header: () => (
      <SortableHeader label="Cantidad a comprar" active={sortBy === "cantidad"} dir={sortDir} align="right" onClick={() => toggleSort("cantidad")} />
    ),
    cell: ({ row }) => (
      <span className={cn("block text-right tabular-nums", row.original.tipo === "material" ? "font-medium text-foreground" : "text-muted-foreground")}>
        {numeroEs(row.original.cantidad)} <span className="text-xs font-normal text-muted-foreground">{row.original.um}</span>
      </span>
    ),
  }),
  ];
}

export default function MrpMaterialsTable({ data }: { data: Material[] }) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  const [sortBy, setSortBy] = useState<SortBy>("cantidad");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const familias = useMemo(() => {
    const map = new Map<string, string>();
    data.forEach((m) => { if (m.familia) map.set(m.familia, m.familiaDescripcion || m.familia); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((m) => {
      const matchQ = !q || m.codigo.toLowerCase().includes(q) || m.descripcion.toLowerCase().includes(q);
      const matchFamilia = familia === "__todas__" || m.familia === familia;
      return matchQ && matchFamilia;
    });
  }, [data, search, familia]);

  // Orden manual del nivel de MATERIAL, no el de TanStack: getSortedRowModel
  // también reordenaría los subRows de cada material por el mismo criterio,
  // descolocando los meses (que deben quedar siempre cronológicos).
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const cmp = sortBy === "cantidad"
        ? a.cantidad - b.cantidad
        : (a.familiaDescripcion || a.familia).localeCompare(b.familiaDescripcion || b.familia);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir(col === "cantidad" ? "desc" : "asc"); }
  };

  const treeData = useMemo(() => toTree(sorted), [sorted]);
  const columns = useMemo(() => buildColumns(sortBy, sortDir, toggleSort), [sortBy, sortDir]);

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
          placeholder="Buscar material por código o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-xs"
        />
        <Select value={familia} onValueChange={(v) => setFamilia(v ?? "__todas__")}>
          <SelectTrigger className="w-44">
            {/* children como función: con un sentinel ("__todas__") como valor
                siempre "seleccionado", Select.Value no está en estado placeholder de
                verdad y su resolución automática del label a veces cae al value
                crudo antes de que el item se haya montado. */}
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
        <span className="text-sm text-muted-foreground">{filtered.length} de {data.length} materiales</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40">
                  {hg.headers.map((h) => (
                    <TableHead key={h.id} className="h-9 px-4 text-muted-foreground">
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={row.getCanExpand() ? () => row.toggleExpanded() : undefined}
                  className={cn(
                    row.original.tipo === "mes" && "bg-muted/20 hover:bg-muted/30",
                    row.getCanExpand() && "cursor-pointer"
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="h-11 px-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <SearchX size={28} className="text-muted-foreground" />
                      <p className="font-medium text-foreground">Sin resultados</p>
                      <p className="text-sm text-muted-foreground">No hay materiales para este filtro.</p>
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
