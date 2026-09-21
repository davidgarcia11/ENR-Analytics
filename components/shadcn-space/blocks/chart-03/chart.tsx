"use client";

// Bloque "Chart 03 - Area Chart Gradient" de ShadcnSpace, adaptado a datos reales
// y convertido a LÍNEAS (ver comentario junto a <Line> más abajo para el porqué)
// (mismo patrón que chart-15/charts-15.tsx en /compras: se edita el archivo
// instalado en el sitio, con un prop `data` real y una etiqueta por defecto —
// no se crea un wrapper aparte en components/nova/). Las dos tarjetas KPI del
// original ("Sales this year/last year") se quitaron, igual que ya se hizo en
// chart-15 — no hay un dato de "año anterior" que tenga sentido aquí, y con
// leyenda de puntos en la cabecera (mismo patrón que Charts15) basta.
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/nova/ui/chart";
import { euros } from "@/components/nova/coste-a1-shared";

export interface CosteMensualDatum {
  mes: string; // etiqueta ya formateada para el eje X (ej. "ene 26")
  teorico: number | null;
  real: number | null;
}

const chartConfig = {
  teorico: {
    label: "Teórico",
    color: "var(--color-sky-400)",
  },
  real: {
    label: "Real",
    color: "var(--color-blue-500)",
  },
} satisfies ChartConfig;

export default function Chart03({
  className,
  data,
}: {
  className?: string;
  data: CosteMensualDatum[];
}) {
  return (
    <Card className={className}>
      {/* CardTitle/<p> como hijos DIRECTOS de CardHeader (mismo patrón que
          chart-04) + leyenda en `CardAction` (el slot del propio Card para
          "acción arriba a la derecha", `has-data-[slot=card-action]:
          grid-cols-[1fr_auto]` en card.tsx) — bug real corregido: la versión
          anterior envolvía título+subtítulo en un `<div>` propio y ponía la
          leyenda al lado con `flex justify-between`, en vez del `grid` que
          usa `CardHeader` por defecto (igual que chart-04, sin leyenda) —
          esa diferencia de mecanismo de layout (flex vs. grid) hacía que las
          dos cabeceras midieran distinto (48px vs. 52px, comprobado con
          `agent-browser`) aunque el texto fuera del mismo tamaño, así que
          las dos tarjetas nunca quedaban exactamente igual de altas. Con
          `CardAction`, las dos cabeceras usan el mismo `grid`. */}
      <CardHeader>
        <CardTitle className="text-lg font-medium text-foreground">Coste real vs. teórico</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Media ponderada por cantidad costeada, artículos filtrados
        </p>
        <CardAction className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="text-muted-foreground">Teórico</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Real</span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="h-[253px] w-full">
          <ChartContainer config={chartConfig} className="h-full w-full">
            <LineChart accessibilityLayer data={data} margin={{ left: 0, right: 12 }}>
              {/* `var(--border)`, no `var(--color-border)` del bloque original —
                  bug real: `--color-border` solo existe en app/globals.css (el
                  sistema de diseño VIEJO, `--color-border: var(--border)`),
                  fuera de [data-nova-theme]; en modo oscuro de Nova no seguía a
                  `--border` de app/nova-theme.css, así que la rejilla se veía
                  con un gris claro fijo (casi blanco) encima del fondo oscuro
                  de la tarjeta — "se ve mucho el blanco", pedido explícito.
                  `var(--border)` es el mismo token que ya usa `chart-15`
                  (compras) y sí es sensible al tema. `strokeWidth` por defecto
                  (1, no 2) + `strokeOpacity={0.5}` — mismo criterio que
                  `chart-15` — para que la rejilla quede de fondo, no compita
                  visualmente con las dos líneas de coste. */}
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={10} />
              {/* 1 decimal, sin espacio antes de "€" (a diferencia de euros(),
                  que lleva hasta 4) — el original usaba sufijo "k" de 2-3
                  caracteres; con `margin.left: -20` (heredado del bloque
                  original) un tick largo como "23,00 €" se salía del todo y se
                  veía cortado por el borde de la tarjeta. Sin decimales
                  (`Math.round`) dos ticks distintos podían redondear al mismo
                  entero (rango real típico de 1-2 €) y se veían duplicados. */}
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={48}
                tickFormatter={(value: number) => `${value.toLocaleString("es-ES", { maximumFractionDigits: 1 })}€`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(value) => (typeof value === "number" ? euros(value) : String(value))}
                  />
                }
              />
              {/* Líneas, no áreas — decisión explícita al revisar el panel: lo que
                  se compara aquí es un RATIO (€ por unidad), no una magnitud
                  acumulable como la de /compras (unidades/€ vendidos, ahí barras
                  agrupadas sí tienen sentido). Rellenar bajo la curva sugiere un
                  volumen que no existe, y con las dos series cerca las áreas
                  translúcidas se solapan y tapan lo único que importa: la
                  DISTANCIA entre teórico y real.
                  `dot` visible a propósito (no `dot={false}`): con el rango por
                  defecto —el mes en curso— solo hay UN punto, y una línea de un
                  solo punto no dibuja nada. */}
              <Line
                dataKey="teorico"
                type="monotone"
                stroke="var(--color-teorico)"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
              <Line
                dataKey="real"
                type="monotone"
                stroke="var(--color-real)"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
