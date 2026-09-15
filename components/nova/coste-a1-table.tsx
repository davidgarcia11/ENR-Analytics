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
// ve ahí (clic en una fila raíz), ver app/costes/page.tsx.
//
// Filtros (buscador, familia, obsoletos) y tabla van en componentes separados —
// `useCosteA1Filters` + `CosteA1FilterBar` + `CosteA1Table` — porque la página los
// coloca en sitios distintos: los filtros arriba (junto a Exportar, antes de los
// KPIs, igual que /compras) y la tabla más abajo, junto al panel de desglose. Sin
// botón "Recalcular" aparte — hacía exactamente lo mismo que "Filtrar" (pedido
// explícito: "el botón recalcular ya no vale, porque ya está el de filtrar").
import { useMemo, useState } from "react";
import {
  useReactTable,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, CircleAlert, ChevronDown, ChevronRight, Filter, Loader2, SearchX } from "lucide-react";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Button } from "@/components/nova/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { ScrollArea } from "@/components/nova/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { cn } from "@/lib/utils";
import MonthRangePicker, { type MonthRange } from "./month-range-picker";
import { DesviacionBadge, desviacionPct, estadoSubarbol, euros, podar1112, type DespieceNode, type EstadoDescuadre } from "./coste-a1-shared";

export type { DespieceNode };

interface TreeRow {
  id: string;
  codigo: string;
  concepto: string;
  tipo: string;
  familia: string;
  familiaDescripcion: string;
  costeA1: number | null;
  costeReal: number | null;
  esRaiz: boolean;
  obsoleto: boolean;
  // Solo tiene valor real en la fila raíz — igual que en DespieceNode, producción
  // real (F4111) del artículo final en el rango de fechas pedido.
  produccion?: number;
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
    costeReal: n.costeReal,
    esRaiz,
    obsoleto: n.obsoleto,
    produccion: n.produccion,
    estado,
    subRows: n.children.length > 0 ? n.children.map((c, i) => toTreeRow(c, `${id}::${i}::${c.codigo}`, false)) : undefined,
  };
}

type SortBy = "nombre" | "coste" | "produccion" | "costeReal" | "desviacion";

// Columna de la tabla (id de TanStack) -> criterio de orden que le corresponde
// — "concepto" (Artículo) ordena por "nombre", el resto comparte literalmente
// el id. Un solo mapa para no repetirlo entre el header sortable y el
// `onClick` que dispara `toggleSort()`.
const SORT_POR_COLUMNA: Record<string, SortBy> = {
  concepto: "nombre",
  coste: "coste",
  produccion: "produccion",
  costeReal: "costeReal",
  desviacion: "desviacion",
};

// --- Filtros: estado + derivados, compartido entre CosteA1FilterBar y CosteA1Table ---

// Mes en curso — mismo default que envía la API sin startDate/endDate
// (app/api/costes/route.ts) y que usa MonthRangePicker/api-compras.
function mesActual(): MonthRange {
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return {
    startDate: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-01`,
    endDate: `${fin.getFullYear()}-${String(fin.getMonth() + 1).padStart(2, "0")}-${String(fin.getDate()).padStart(2, "0")}`,
  };
}

export function useCosteA1Filters(data: DespieceNode[]) {
  const [search, setSearch] = useState("");
  const [familia, setFamilia] = useState("__todas__");
  const [sortBy, setSortBy] = useState<SortBy>("coste");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Rango de meses para la producción real — pedido explícito, sustituye al botón
  // "Mostrar obsoletos": ya no se elige a mano, un artículo obsoleto se ve en la
  // tabla SOLO si tuvo producción en este rango (ver `filtered` más abajo). Estado
  // "no reactivo" a propósito — cambiar el rango no dispara ninguna consulta hasta
  // pulsar "Filtrar" (mismo patrón que /compras, MonthRangePicker no lo impone).
  const [monthRange, setMonthRange] = useState<MonthRange>(mesActual);

  const familias = useMemo(() => {
    const map = new Map<string, string>();
    data.forEach((n) => { if (n.familia) map.set(n.familia, n.familiaDescripcion || n.familia); });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  // Un obsoleto solo se ve si tuvo producción real (> 0) en el rango de fechas
  // pedido a la API — pedido explícito: "en vez de poner lo de obsoletos como está
  // ahora, tiene que salir en la tabla ese artículo obsoleto solo si ha tenido
  // producción en ese rango de fechas". `produccion` viene de la API (solo en la
  // raíz, ver DespieceNode) — `?? 0` cubre el caso sin rango pedido todavía.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((n) => {
      const matchQ = !q || n.codigo.toLowerCase().includes(q) || n.descripcion.toLowerCase().includes(q);
      const matchFamilia = familia === "__todas__" || n.familia === familia;
      const matchObsoleto = !n.obsoleto || (n.produccion ?? 0) > 0;
      return matchQ && matchFamilia && matchObsoleto;
    });
  }, [data, search, familia]);

  // `null`/`undefined` ("—" en la tabla) siempre al final, sea cual sea la
  // dirección — que un "sin dato" salte de arriba a abajo solo por pulsar la
  // cabecera dos veces sería confuso, y no aporta nada ordenar por "quién no
  // tiene coste real" en vez de por el valor en sí.
  function compararConNulos(av: number | null | undefined, bv: number | null | undefined, dir: "asc" | "desc"): number {
    const aNulo = av == null;
    const bNulo = bv == null;
    if (aNulo && bNulo) return 0;
    if (aNulo) return 1;
    if (bNulo) return -1;
    const cmp = av - bv;
    return dir === "asc" ? cmp : -cmp;
  }

  // Orden manual del nivel RAÍZ únicamente — getSortedRowModel de TanStack también
  // reordenaría los hijos de cada árbol por el mismo criterio, descolocando el orden
  // por cantidad descendente que ya viene calculado desde la API.
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortBy === "nombre") {
        const cmp = (a.descripcion || a.codigo).localeCompare(b.descripcion || b.codigo);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "produccion") return compararConNulos(a.produccion, b.produccion, sortDir);
      // Coste Real: "—" cuenta como 0, no "al final sea cual sea la dirección"
      // como el resto de columnas — pedido explícito: "que el vacío se tome
      // como 0 para que salga de los primeros si ordenan de menor a mayor".
      // Con costes siempre ≥ 0, un artículo sin coste real queda entre los
      // primeros al ordenar ascendente (junto a los que de verdad cuestan 0)
      // y entre los últimos al ordenar descendente — como si sí tuviera dato.
      if (sortBy === "costeReal") {
        const cmp = (a.costeReal ?? 0) - (b.costeReal ?? 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortBy === "desviacion") return compararConNulos(desviacionPct(a), desviacionPct(b), sortDir);
      return compararConNulos(a.costeA1, b.costeA1, sortDir); // "coste"
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const toggleSort = (col: SortBy) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir(col === "nombre" ? "asc" : "desc"); }
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
    search, setSearch, familia, setFamilia, monthRange, setMonthRange,
    sortBy, sortDir, toggleSort, familias, filtered, treeData,
    totalCount: data.length,
  };
}

export type CosteA1Filters = ReturnType<typeof useCosteA1Filters>;

// --- Barra de filtros: arriba de los KPI, junto a Exportar (mismo orden que
// /compras — todos los controles antes de las tarjetas KPI) ---

// `onFiltrarFechas`: dispara la consulta a la API con el `monthRange` actual —
// vive en la página (app/costes/page.tsx), no aquí, porque cambia lo que se
// PIDE al servidor, no un filtro puramente local como búsqueda/familia.
// `loading`: mismo dato que ya tenía la página para el botón "Recalcular" (ya
// eliminado) — el botón "Filtrar" es ahora el único disparador de la consulta,
// así que necesita su propio estado de carga.
export function CosteA1FilterBar({ filtros, onFiltrarFechas, loading }: { filtros: CosteA1Filters; onFiltrarFechas: () => void; loading: boolean }) {
  const { search, setSearch, familia, setFamilia, familias, monthRange, setMonthRange, filtered, totalCount } = filtros;
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
        {/* alignItemWithTrigger=false: el comportamiento por defecto (estilo
            <select> nativo) alinea el ítem SELECCIONADO con el trigger en vez
            de anclar el desplegable debajo — con una familia hacia el final
            de la lista (alfabética, 10 opciones) el desplegable se abría
            hacia ARRIBA, tapando la barra de navegación, y se veía
            desalineado. Con esto se comporta como un desplegable normal:
            siempre debajo del trigger, alineado a su izquierda. */}
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectItem value="__todas__">Todas las familias</SelectItem>
          {familias.map(([code, desc]) => (
            <SelectItem key={code} value={code}>{desc}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MonthRangePicker value={monthRange} onChange={setMonthRange} />
      {/* Mismo diseño que el botón "Filtrar" de /compras (app/compras/page.tsx):
          variante por defecto (no "outline"), icono Filter/spinner según `loading`. */}
      <Button size="sm" className="gap-1.5" onClick={onFiltrarFechas} disabled={loading}>
        {/* `transform-gpu` PROBADO y REVERTIDO — pensado para el pequeño
            bamboleo vertical del icono al girar, pero en la práctica
            interfería con el propio `transform: rotate(...)` de
            `animate-spin` (las dos clases fijan la misma propiedad
            `transform` por vías distintas — Tailwind v4 compone
            `transform-gpu` a partir de variables `--tw-rotate-*`, mientras
            que el keyframe de `animate-spin` escribe `transform` literal, y
            una pisaba a la otra) y dejaba el icono completamente QUIETO en
            vez de solo bambolear menos — "la ruleta de carga no gira ni en
            el botón de filtrar ni en el mensaje emergente", reportado de
            inmediato. Un icono que gira con un bamboleo mínimo es un mal
            menor frente a uno que no gira en absoluto. */}
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
        Filtrar
      </Button>
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
      header: () => <SortableHeaderLabel label="Artículo" active={sortBy === "nombre"} dir={sortDir} />,
      cell: ({ row }) => {
        const r = row.original;
        // Bug real corregido: sin tope de ancho ni `truncate`, una descripción
        // larga + la badge "Obsoleto" (que nunca envolvía de línea, solo
        // `gap-2` en fila) estiraban la columna Artículo a su ancho natural —
        // con `table-layout: auto` (por defecto), ESA columna pasaba a medir
        // lo mismo en TODAS las filas, no solo en la del artículo largo,
        // desbordando la tabla mucho más de lo necesario. `min-w-0` en toda la
        // cadena de contenedores flex (imprescindible: sin él, un hijo flex
        // nunca se encoge por debajo de su ancho de contenido, así que
        // `truncate` no tiene efecto) + `max-w-[13rem] truncate` en el propio
        // texto tapan la columna a un ancho razonable — la badge lleva
        // `shrink-0` para no perder su tamaño si el texto se recorta.
        const contenido = (
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn("min-w-0 max-w-[13rem] truncate font-medium text-foreground", r.esRaiz && "font-semibold")}
                title={r.concepto}
              >
                {r.concepto}
              </span>
              {/* Sin badge de tipo (Producto terminado/semiterminado) aquí — pedido
                  explícito, hacía falta el hueco para que la Desviación quepa sin
                  scroll horizontal. El tipo se sigue viendo en el panel de la
                  derecha (Desglose/Comparación), donde sí hay sitio. */}
              {r.obsoleto && <Badge variant="destructive" className="shrink-0 font-normal">Obsoleto</Badge>}
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
          <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: row.depth * 22 }}>
            {r.subRows && r.subRows.length > 0 ? (
              <span className="flex min-w-0 items-center gap-2" aria-expanded={row.getIsExpanded()}>
                {row.getIsExpanded() ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                {contenido}
              </span>
            ) : (
              <span className="min-w-0 pl-[22px]">{contenido}</span>
            )}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "coste",
      // "Teórico", no "Coste Teórico" — bug real corregido: a anchos de
      // ventana estrechos (~1024px, el breakpoint `lg` donde la tabla pasa a
      // ocupar solo 2/3 del ancho) el propio TEXTO de las cabeceras era más
      // ancho que los valores que muestran, y las 5 columnas dejaban de
      // caber — se veía la barra de scroll horizontal incluso con una sola
      // fila de datos. Mismos nombres cortos que ya usa el panel de
      // desglose ("Teórico X € · Real Y € · Desv. Z %") — más consistente,
      // no solo más corto.
      header: () => <SortableHeaderLabel label="Teórico" active={sortBy === "coste"} dir={sortDir} align="right" />,
      cell: ({ row }) => (
        <span className={cn("block text-right tabular-nums", row.original.esRaiz ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {row.original.costeA1 != null ? euros(row.original.costeA1) : "—"}
        </span>
      ),
    }),
    // Producción real (F4111, ILDCT='IC') del artículo final en el rango de fechas
    // del filtro. Solo tiene valor en la fila raíz (`produccion` viene
    // `undefined` en los componentes, ver DespieceNode).
    columnHelper.display({
      id: "produccion",
      header: () => <SortableHeaderLabel label="Producción" active={sortBy === "produccion"} dir={sortDir} align="right" />,
      cell: ({ row }) => (
        <span className={cn("block text-right tabular-nums", row.original.esRaiz ? "text-foreground" : "text-muted-foreground")}>
          {row.original.produccion != null ? row.original.produccion.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "—"}
        </span>
      ),
    }),
    // Coste real: media ponderada por producción mensual de F30026.IECSL
    // (IECOST='A1') en el rango de fechas (ver app/api/costes/route.ts,
    // apartado "Coste real"). "—" cuando ningún mes del rango tiene ledger
    // configurado en /admin, o F30026 no tiene coste para ese ledger en esos
    // meses.
    columnHelper.display({
      id: "costeReal",
      header: () => <SortableHeaderLabel label="Real" active={sortBy === "costeReal"} dir={sortDir} align="right" />,
      cell: ({ row }) => (
        <span className={cn("block text-right tabular-nums", row.original.esRaiz ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {row.original.costeReal != null ? euros(row.original.costeReal) : "—"}
        </span>
      ),
    }),
    // Desviación: coste real vs. coste teórico (A1) — positivo = el real sale
    // más caro que el estándar declarado.
    columnHelper.display({
      id: "desviacion",
      header: () => <SortableHeaderLabel label="Desv." active={sortBy === "desviacion"} dir={sortDir} align="right" />,
      cell: ({ row }) => {
        const pct = desviacionPct(row.original);
        if (pct == null) {
          return <span className="block text-right tabular-nums text-muted-foreground">—</span>;
        }
        // Píldora con fondo en TODAS las filas — pedido explícito ("ponle al
        // final a todos el fondo en la desviación"), revierte la ronda
        // anterior que la dejaba solo en la fila raíz.
        return (
          <div className="flex justify-end">
            <DesviacionBadge pct={pct} tono="xs" />
          </div>
        );
      },
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
    // interno, esta sí — pedido explícito en otra ronda, ver docs/costes.md §4.1).
    <Card className="p-0">
      <CardHeader className="px-6 pt-6">
        <CardTitle className="text-lg font-medium text-foreground">Coste por artículo final</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Pulsa una fila raíz para ver su desglose.
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
                    const sortKey = SORT_POR_COLUMNA[h.column.id];
                    return (
                      <TableHead
                        key={h.id}
                        className={cn("h-9 bg-muted/40 px-3 text-muted-foreground", sortKey && "cursor-pointer select-none")}
                        onClick={sortKey ? () => toggleSort(sortKey) : undefined}
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
                    {/* px-3 (no px-4) — pedido explícito: con la producción real
                        (Enero-Septiembre 2026: números de hasta 6 cifras, p. ej.
                        "37.506", frente al "0" fijo de antes) la tabla dejaba de
                        caber sin deslizar, cortando un poco la columna Desviación.
                        Mismo ajuste que ya se hizo en el panel de desglose para el
                        mismo problema (menos margen interno, no menos columnas). */}
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="h-12 px-3 py-0 align-middle">
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
