"use client";

// Tabla de coste A1 (columna izquierda del panel) — árbol real de profundidad
// variable (subRows de TanStack), igual patrón que hierarchical-table.tsx (compras)
// y mrp-materials-table.tsx: fila completa clicable para desplegar, indentación por
// profundidad, sin tabla anidada en una celda. La API ya devuelve el árbol completo
// anidado (children recursivos, cualquier profundidad) — toTree() solo traduce la
// forma, no reconstruye niveles fijos.
//
// El desglose completo (antes un modal aparte) vive en un panel a la derecha
// (coste-a1-desglose-panel.tsx) — esta tabla solo selecciona QUÉ artículo final se
// ve ahí (clic en una fila raíz), ver app/coste-a1/page.tsx.
//
// Filtros (buscador, familia, obsoletos) y tabla van en componentes separados —
// `useCosteA1Filters` + `CosteA1FilterBar` + `CosteA1Table` — porque la página los
// coloca en sitios distintos: los filtros arriba (junto a Recalcular/Exportar,
// antes de los KPIs, igual que /compras) y la tabla más abajo, junto al panel de
// desglose.
import { useMemo, useState } from "react";
import {
  useReactTable,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CircleAlert, ChevronDown, ChevronRight, Eye, EyeOff, SearchX } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Button } from "@/components/nova/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { ScrollArea } from "@/components/nova/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { cn } from "@/lib/utils";
import { estadoSubarbol, euros, podar1112, type DespieceNode, type EstadoDescuadre } from "./coste-a1-shared";

export type { DespieceNode };

interface TreeRow {
  id: string;
  codigo: string;
  concepto: string;
  tipo: string;
  familia: string;
  familiaDescripcion: string;
  costeA1: number | null;
  esRaiz: boolean;
  obsoleto: boolean;
  // Solo se rellena en la fila raíz — estado del árbol COMPLETO (sin podar), no solo
  // de lo que enseña el informe (11/12). Ver coste-a1-shared.ts (estadoSubarbol).
  estado?: EstadoDescuadre;
  subRows?: TreeRow[];
}

function toTreeRow(n: DespieceNode, id: string, esRaiz: boolean, estado?: EstadoDescuadre): TreeRow {
  return {
    id,
    codigo: n.codigo,
    concepto: n.descripcion || "(sin descripción)",
    tipo: n.tipo,
    familia: n.familia,
    familiaDescripcion: n.familiaDescripcion,
    costeA1: n.costeA1,
    esRaiz,
    obsoleto: n.obsoleto,
    estado,
    subRows: n.children.length > 0 ? n.children.map((c, i) => toTreeRow(c, `${id}::${i}::${c.codigo}`, false)) : undefined,
  };
}

type SortBy = "coste" | "nombre";

// --- Filtros: estado + derivados, compartido entre CosteA1FilterBar y CosteA1Table ---

export function useCosteA1Filters(data: DespieceNode[]) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  // Ocultos por defecto — pedido explícito: "no quiero que aparezcan los O, que
  // haya un botón que se pueda mostrar los Obsoletos si quieren".
  const [mostrarObsoletos, setMostrarObsoletos] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("coste");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const familias = useMemo(() => {
    const map = new Map<string, string>();
    data.forEach((n) => { if (n.familia) map.set(n.familia, n.familiaDescripcion || n.familia); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const obsoletosOcultos = useMemo(() => data.filter((n) => n.obsoleto).length, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((n) => {
      const matchQ = !q || n.codigo.toLowerCase().includes(q) || n.descripcion.toLowerCase().includes(q);
      const matchFamilia = familia === "__todas__" || n.familia === familia;
      const matchObsoleto = mostrarObsoletos || !n.obsoleto;
      return matchQ && matchFamilia && matchObsoleto;
    });
  }, [data, search, familia, mostrarObsoletos]);

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

  // Informe: podado a solo 11/12 — ver podar1112() en coste-a1-shared. El desglose
  // completo (10/13/14 incluidos) vive en el panel de la derecha.
  // estadoSubarbol() se calcula SOBRE EL ÁRBOL SIN PODAR (n, no podar1112(n)) — un
  // descuadre (o un coste que falta) puede estar en un nivel que el informe no
  // enseña (10/13/14), y aun así hay que avisar de que algo no cuadra o no se puede
  // verificar del todo.
  const treeData = useMemo(
    () => sorted.map((n, i) => toTreeRow(podar1112(n), `${i}::${n.codigo}`, true, estadoSubarbol(n))),
    [sorted]
  );

  return {
    search, setSearch, familia, setFamilia, mostrarObsoletos, setMostrarObsoletos,
    sortBy, sortDir, toggleSort, familias, obsoletosOcultos, filtered, treeData,
    totalCount: data.length,
  };
}

export type CosteA1Filters = ReturnType<typeof useCosteA1Filters>;

// --- Barra de filtros: arriba de los KPI, junto a Recalcular/Exportar (mismo orden
// que /compras — todos los controles antes de las tarjetas KPI) ---

export function CosteA1FilterBar({ filtros }: { filtros: CosteA1Filters }) {
  const { search, setSearch, familia, setFamilia, familias, mostrarObsoletos, setMostrarObsoletos, obsoletosOcultos, filtered, totalCount } = filtros;
  return (
    <>
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
      {obsoletosOcultos > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground"
          onClick={() => setMostrarObsoletos((v) => !v)}
        >
          {mostrarObsoletos ? <EyeOff size={14} /> : <Eye size={14} />}
          {mostrarObsoletos ? "Ocultar" : "Mostrar"} obsoletos ({obsoletosOcultos})
        </Button>
      )}
      <span className="text-sm text-muted-foreground">{filtered.length} de {totalCount} artículos finales</span>
    </>
  );
}

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
              {/* Sin badge de tipo (Producto terminado/semiterminado) aquí — pedido
                  explícito, hacía falta el hueco para que la Desviación quepa sin
                  scroll horizontal. El tipo se sigue viendo en el panel de la
                  derecha (Desglose/Comparación), donde sí hay sitio. */}
              {r.obsoleto && <Badge variant="destructive" className="font-normal">Obsoleto</Badge>}
              {r.esRaiz && r.estado === "problema" && (
                <CircleAlert
                  size={14}
                  className="shrink-0 text-[color:var(--color-destructive)]"
                  aria-label="Hay un descuadre confirmado en algún punto del despiece completo"
                />
              )}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{r.codigo}</span>
          </span>
        );
        return (
          <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 22 }}>
            {r.subRows && r.subRows.length > 0 ? (
              <span className="flex items-center gap-2" aria-expanded={row.getIsExpanded()}>
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
      id: "coste",
      header: () => <SortableHeaderLabel label="Coste Teórico" active={sortBy === "coste"} dir={sortDir} align="right" />,
      cell: ({ row }) => (
        <span className={cn("block text-right tabular-nums", row.original.esRaiz ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {row.original.costeA1 != null ? euros(row.original.costeA1) : "—"}
        </span>
      ),
    }),
    // Producción y Coste Real: placeholder fijo, aún no hay fuente de datos real
    // (pedido explícito) — Coste Real se muestra igual al Coste Teórico y
    // Producción a 0, para no insinuar un análisis que todavía no existe.
    columnHelper.display({
      id: "produccion",
      header: () => <span className="block text-right">Producción</span>,
      cell: () => <span className="block text-right tabular-nums text-muted-foreground">0</span>,
    }),
    columnHelper.display({
      id: "costeReal",
      header: () => <span className="block text-right">Coste Real</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-muted-foreground">
          {row.original.costeA1 != null ? euros(row.original.costeA1) : "—"}
        </span>
      ),
    }),
    columnHelper.display({
      id: "desviacion",
      header: () => <span className="block text-right">Desviación</span>,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums text-muted-foreground">
          {row.original.costeA1 != null ? "0,0 %" : "—"}
        </span>
      ),
    }),
  ];
}

export default function CosteA1Table({
  filtros,
  selectedCodigo,
  onSelectCodigo,
}: {
  filtros: CosteA1Filters;
  selectedCodigo: string | null;
  onSelectCodigo: (codigo: string) => void;
}) {
  const { treeData, sortBy, sortDir, toggleSort, filtered } = filtros;
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
    // Cabecera, bordes y colores calcados de hierarchical-table.tsx (compras) —
    // pedido explícito ("quiero que se parezca mucho la tabla"): CardHeader sin
    // borde propio (el separador vive en CardContent, border-t), TableHead con
    // bg-muted/40 + texto normal (no versalitas), filas con border-border/60 (más
    // suave que el borde por defecto) y sin ningún tinte de fondo propio — todo
    // igual que compras. La única diferencia estructural real es que esta tabla
    // necesita `sticky`/`backdrop-blur` en la cabecera (compras no tiene scroll
    // interno, esta sí — pedido explícito en otra ronda, ver docs/coste-a1.md §4.1).
    <Card className="p-0">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="text-lg font-medium text-foreground">Coste por artículo final</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Pulsa una fila raíz para ver su desglose. Producción y Coste Real son ficticios.
        </p>
      </CardHeader>
      <CardContent className="overflow-hidden rounded-b-xl border-t border-border p-0">
        <ScrollArea className="h-[32rem]" orientation="both">
          {/* <table> suelta, NO el componente <Table> compartido (components/nova/ui/table.tsx):
              ese componente envuelve el <table> en su propio div `overflow-x-auto`, y anidar
              ESE div dentro del Viewport de ScrollArea rompe la cabecera sticky — por la regla
              de interdependencia de overflow de CSS, un div con overflow-x:auto computa
              overflow-y a auto también, así que ese div (que nunca necesita desplazarse él
              mismo, todo el contenido cabe en su alto natural) pasa a ser el "ancestro con
              scroll" más cercano para position:sticky en vez del Viewport real que el usuario
              efectivamente desplaza — el sticky deja de pegarse a nada visible. Aquí el propio
              ScrollArea (orientation="both") ya cubre el scroll horizontal, así que no hace
              falta el div de Table. */}
          <table className="w-full caption-bottom text-sm">
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="sticky top-0 z-10 border-border/60 backdrop-blur-sm">
                  {hg.headers.map((h) => {
                    const sortable = h.column.id === "coste";
                    return (
                      <TableHead
                        key={h.id}
                        className={cn("h-9 bg-muted/40 px-4 text-muted-foreground", sortable && "cursor-pointer select-none")}
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
              {table.getRowModel().rows.map((row) => {
                const seleccionada = row.original.esRaiz && row.original.codigo === selectedCodigo;
                return (
                  <TableRow
                    key={row.id}
                    onClick={() => {
                      if (row.original.esRaiz) onSelectCodigo(row.original.codigo);
                      if (row.getCanExpand()) row.toggleExpanded();
                    }}
                    className={cn(
                      // Mismo hover/expandido/borde que hierarchical-table.tsx
                      // (compras): sin tinte de fondo propio por fila — solo el
                      // hover:bg-muted/50 y has-aria-expanded:bg-muted/50 que ya
                      // trae <TableRow> por defecto (ui/table.tsx). La única
                      // excepción es la fila seleccionada (concepto propio de este
                      // panel, no existe en compras): esa sí lleva un tinte muy
                      // suave, SIN contorno — un `outline` en color primario (rojo
                      // de marca) se leía como "borde oscuro" y además ese mismo
                      // rojo ya significa "problema/descuadre" en esta tabla
                      // (CircleAlert, Descuadre) — usarlo también para "seleccionada"
                      // mezclaba dos significados distintos con el mismo color.
                      "h-12 cursor-pointer border-border/60",
                      seleccionada && "bg-primary/[0.06] hover:bg-primary/[0.09]"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="h-12 px-4 py-0 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
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
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
