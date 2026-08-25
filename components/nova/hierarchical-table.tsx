"use client";

import * as React from "react";
import {
  useReactTable,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/nova/ui/table";
import { Badge } from "@/components/nova/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { cn } from "@/lib/utils";

// Píldoras de ruta (no el Breadcrumb clásico de texto): el último nivel (abierto) va
// sólido, los anteriores en outline. Pulsar un nivel anterior vuelve a él (colapsa lo
// de más abajo). Viven en la cabecera de ESTA tarjeta (no en la barra superior de la
// página) — `drill` sigue siendo el único punto de verdad, compartido con el gráfico
// "Evolución mensual".
function DrillPills({ drill, onNavigate }: { drill: DrillState; onNavigate: (next: DrillState) => void }) {
  const pill = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-muted"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pill("Todas las familias", !drill.familia, () => onNavigate({ familia: null, canal: null, canalLabel: null }))}
      {drill.familia && (
        <>
          <ChevronRight size={14} className="text-muted-foreground" />
          {pill(drill.familia, !drill.canal, () => onNavigate({ familia: drill.familia, canal: null, canalLabel: null }))}
        </>
      )}
      {drill.familia && drill.canal && (
        <>
          <ChevronRight size={14} className="text-muted-foreground" />
          {pill(drill.canalLabel ?? drill.canal, true, () => onNavigate(drill))}
        </>
      )}
    </div>
  );
}

// Tabla jerárquica Familia > Canal > Artículo — árbol real (Opción 1): subRows de
// TanStack Table, no un panel de detalle fijo (Opción 2, descartada). Un solo camino
// abierto a la vez (acordeón), como en la captura de referencia: expandir una familia
// distinta cierra la anterior; expandir un canal distinto dentro de la misma familia
// cierra el otro. El camino abierto se reporta a la página (onDrillChange) para
// sincronizar las píldoras de ruta y el gráfico "Evolución mensual".

export interface Metric {
  previsto: number;
  real: number;
  desviacionAbs: number;
  desviacionPct: number | null;
}

export type Unit = "unidades" | "kg" | "importe";

export interface ArticuloRow {
  tipo: "articulo";
  item: string;
  descripcion: string;
  unidades: Metric;
  kg: Metric | null;
  importe: Metric | null;
}

export interface CanalRow {
  tipo: "canal";
  canal: string | null; // código AAZE06 (HOR, RET...) — identidad interna, no se muestra
  canalLabel: string; // descripción real (UDC 17/B6) o "Sin canal" — lo que se muestra
  unidades: Metric;
  kg: Metric | null;
  importe: Metric | null;
  articulos: ArticuloRow[];
}

export interface FamiliaRow {
  tipo: "familia";
  familia: string;
  unidades: Metric;
  kg: Metric | null;
  importe: Metric | null;
  canales: CanalRow[];
}

function metricPara(unit: Unit, r: { unidades: Metric; kg: Metric | null; importe: Metric | null }): Metric | null {
  return unit === "kg" ? r.kg : unit === "importe" ? r.importe : r.unidades;
}

// Importe siempre con "€" — el resto de unidades no llevan sufijo.
function formatNum(v: number, unit: Unit): string {
  return unit === "importe" ? `${numeroEs(v)} €` : numeroEs(v);
}

// Fila unificada para el árbol de TanStack (subRows exige una forma homogénea).
// `concepto` es SIEMPRE lo que se muestra (la descripción, nunca un código);
// `canalCode` es la identidad interna de una fila de canal, usada para el estado
// `drill` compartido con la página y para las claves de /api/compras-v2 (que sí usan
// el código, no la descripción).
interface TreeRow {
  id: string;
  tipo: "familia" | "canal" | "articulo";
  concepto: string;
  canalCode?: string | null;
  item?: string;
  refs?: number;
  unidades: Metric;
  kg: Metric | null;
  importe: Metric | null;
  subRows?: TreeRow[];
}

function toTree(familias: FamiliaRow[]): TreeRow[] {
  return familias.map((f) => ({
    id: f.familia,
    tipo: "familia",
    concepto: f.familia,
    refs: f.canales.reduce((s, c) => s + c.articulos.length, 0),
    unidades: f.unidades,
    kg: f.kg,
    importe: f.importe,
    subRows: f.canales.map((c) => ({
      id: `${f.familia}::${c.canal ?? "__sin_canal__"}`,
      tipo: "canal",
      concepto: c.canalLabel,
      canalCode: c.canal,
      unidades: c.unidades,
      kg: c.kg,
      importe: c.importe,
      subRows: c.articulos.map((a) => ({
        id: `${f.familia}::${c.canal ?? "__sin_canal__"}::${a.item}`,
        tipo: "articulo",
        concepto: a.descripcion,
        item: a.item,
        unidades: a.unidades,
        kg: a.kg,
        importe: a.importe,
      })),
    })),
  }));
}

// Formateo manual (no Intl/toLocaleString): en este entorno el runtime de Node/Bun no
// trae datos ICU completos para 'es-ES' — toLocaleString('es-ES') se queda callado y
// devuelve el número sin separador de miles (comprobado: (1662).toLocaleString('es-ES')
// -> "1662", no "1.662"). Mismo patrón que usan produccion/caducados/etc., pero aquí lo
// garantizamos sin depender de la configuración ICU del servidor.
function numeroEs(v: number): string {
  const rounded = Math.round(v);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function DesviacionPct({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("font-medium", pct >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-destructive)]")}>
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function Cumplimiento({ pct }: { pct: number | null }) {
  // Escala sobre 130% (el 100% queda a ~77% del ancho). Barra propia (el primitive
  // Progress fija bg-primary en el indicador, no se puede recolorear por signo).
  // opacity-70: menos saturado, el % siempre en muted-foreground (nunca coloreado).
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const cumplimiento = 100 + pct;
  const anchoPct = Math.max(0, Math.min(100, (cumplimiento / 130) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full opacity-70", pct >= 0 ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-destructive)]")}
          style={{ width: `${anchoPct}%` }}
        />
      </div>
      <span className="w-10 text-right text-sm tabular-nums text-muted-foreground">{Math.round(cumplimiento)}%</span>
    </div>
  );
}

const columnHelper = createColumnHelper<TreeRow>();

function buildColumns(unit: Unit) {
  const metricOf = (r: TreeRow) => metricPara(unit, r);

  return [
    columnHelper.display({
      id: "concepto",
      header: () => <span>Concepto</span>,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 22 }}>
            {r.subRows && r.subRows.length > 0 ? (
              <button
                type="button"
                onClick={row.getToggleExpandedHandler()}
                aria-expanded={row.getIsExpanded()}
                className="flex items-center gap-2 text-left"
              >
                {row.getIsExpanded() ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                <span className={cn(r.tipo === "familia" ? "font-semibold text-foreground" : "font-medium text-foreground")}>
                  {r.concepto}
                </span>
                {r.tipo === "familia" && r.refs != null && (
                  <Badge className="bg-muted font-normal text-muted-foreground">{r.refs} refs.</Badge>
                )}
              </button>
            ) : (
              <span className="flex items-center gap-2 pl-[22px]">
                <span className="text-muted-foreground">·</span>
                {r.item && <span className="font-mono text-xs text-muted-foreground">{r.item}</span>}
                <span className="text-foreground">{r.concepto}</span>
              </span>
            )}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "previsto",
      header: () => <span className="block text-right">Previsión</span>,
      cell: ({ row }) => {
        const m = metricOf(row.original);
        return <span className="block text-right tabular-nums text-muted-foreground">{m ? formatNum(m.previsto, unit) : "—"}</span>;
      },
    }),
    columnHelper.display({
      id: "real",
      header: () => <span className="block text-right">Real</span>,
      cell: ({ row }) => {
        const m = metricOf(row.original);
        return <span className="block text-right font-semibold tabular-nums text-foreground">{m ? formatNum(m.real, unit) : "—"}</span>;
      },
    }),
    columnHelper.display({
      id: "desv",
      header: () => <span className="block text-right">Desv.</span>,
      cell: ({ row }) => {
        const m = metricOf(row.original);
        if (!m) return <span className="block text-right text-muted-foreground">—</span>;
        return (
          <span className={cn("block text-right tabular-nums", m.desviacionAbs >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-destructive)]")}>
            {m.desviacionAbs >= 0 ? "+" : ""}
            {formatNum(m.desviacionAbs, unit)}
          </span>
        );
      },
    }),
    columnHelper.display({
      id: "desvPct",
      header: () => <span className="block text-right">Desv. %</span>,
      cell: ({ row }) => {
        const m = metricOf(row.original);
        return <div className="text-right">{m ? <DesviacionPct pct={m.desviacionPct} /> : "—"}</div>;
      },
    }),
    columnHelper.display({
      id: "cumplimiento",
      header: () => <span>Cumplimiento</span>,
      cell: ({ row }) => {
        const m = metricOf(row.original);
        return m ? <Cumplimiento pct={m.desviacionPct} /> : <span className="text-muted-foreground">—</span>;
      },
    }),
  ];
}

export interface DrillState {
  familia: string | null;
  canal: string | null; // código (HOR, RET...) o "__sin_canal__" — null = sin canal elegido
  canalLabel: string | null; // descripción a mostrar en píldoras, denormalizada aquí para no repetir el catálogo en la página
}

export default function HierarchicalTable({
  familias,
  unit,
  drill,
  onDrillChange,
  total,
}: {
  familias: FamiliaRow[];
  unit: Unit;
  drill: DrillState;
  onDrillChange: (next: DrillState) => void;
  total?: { unidades: Metric; kg: Metric | null; importe: Metric | null };
}) {
  const columns = React.useMemo(() => buildColumns(unit), [unit]);
  const data = React.useMemo(() => toTree(familias), [familias]);

  // Un solo camino abierto a la vez (acordeón), derivado directamente de `drill` — así
  // la tabla y las píldoras de ruta nunca se desincronizan entre sí.
  const expanded = React.useMemo(() => {
    const exp: Record<string, boolean> = {};
    if (drill.familia) exp[drill.familia] = true;
    if (drill.familia && drill.canal) exp[`${drill.familia}::${drill.canal}`] = true;
    return exp;
  }, [drill]);

  const table = useReactTable({
    data,
    columns,
    state: { expanded },
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const handleToggle = (row: TreeRow) => {
    if (row.tipo === "familia") {
      onDrillChange(
        drill.familia === row.concepto
          ? { familia: null, canal: null, canalLabel: null }
          : { familia: row.concepto, canal: null, canalLabel: null }
      );
    } else if (row.tipo === "canal") {
      // Identidad por código (canalCode), nunca por el texto mostrado — "Sin canal" es
      // ambiguo como identidad (varias familias tienen su propio "sin canal").
      const codigo = row.canalCode ?? "__sin_canal__";
      onDrillChange(
        drill.canal === codigo
          ? { familia: drill.familia, canal: null, canalLabel: null }
          : { familia: drill.familia, canal: codigo, canalLabel: row.concepto }
      );
    }
  };

  return (
    <Card className="p-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6">
        <div>
          <CardTitle className="text-lg font-medium text-foreground">Desglose jerárquico</CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            Familia › tipo de distribución › artículo. Pulsa una fila para desplegar.
          </p>
        </div>
        <DrillPills drill={drill} onNavigate={onDrillChange} />
      </CardHeader>
      <CardContent className="overflow-hidden rounded-b-xl border-t border-border p-0">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-border/60">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="h-9 bg-muted/40 px-4 text-muted-foreground">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const r = row.original;
              // Todas las filas en blanco (bg-card) siempre — sin tinte por nivel ni por
              // umbral (así lo pidió el usuario: nunca una fila verdosa/rojiza de fondo,
              // "fuera de umbral" ya se ve en el color de Desv./Desv.%/Cumplimiento). Al
              // desplegar, el mismo bg-muted/50 que el hover — via has-aria-expanded del
              // propio primitive Table (ver aria-expanded en el botón de abajo), no una
              // clase de fondo aparte.
              return (
                <TableRow
                  key={row.id}
                  onClick={() => handleToggle(r)}
                  className={cn(
                    "h-12 border-border/60",
                    r.subRows && r.subRows.length > 0 && "cursor-pointer"
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
            {total && (() => {
              const m = metricPara(unit, total);
              return (
                <TableRow className="h-12 border-t-2 border-border bg-muted/40 font-semibold">
                  <TableCell className="h-12 px-4 py-0 align-middle text-foreground">Total general</TableCell>
                  <TableCell className="h-12 px-4 py-0 text-right align-middle tabular-nums text-muted-foreground">
                    {m ? formatNum(m.previsto, unit) : "—"}
                  </TableCell>
                  <TableCell className="h-12 px-4 py-0 text-right align-middle tabular-nums text-foreground">
                    {m ? formatNum(m.real, unit) : "—"}
                  </TableCell>
                  <TableCell className="h-12 px-4 py-0 text-right align-middle tabular-nums">
                    {m ? (
                      <span className={m.desviacionAbs >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-destructive)]"}>
                        {m.desviacionAbs >= 0 ? "+" : ""}
                        {formatNum(m.desviacionAbs, unit)}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="h-12 px-4 py-0 align-middle">
                    <div className="text-right">
                      <DesviacionPct pct={m?.desviacionPct ?? null} />
                    </div>
                  </TableCell>
                  {/* Sin barra de Cumplimiento en el Total general — así sale en la captura */}
                  <TableCell className="h-12 px-4 py-0 align-middle" />
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
        </div>
      </CardContent>
    </Card>
  );
}
