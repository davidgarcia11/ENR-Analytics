"use client";

import { Grip, TriangleAlert } from "lucide-react";

import {
  Card,
  CardDescription,
  CardTitle,
  CardHeader,
  CardContent,
} from "@/components/nova/ui/card";

import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/nova/ui/chart";

// Chart 12 de ShadcnSpace (Employee Salary: barras con la mayor resaltada y dos totales
// debajo) parametrizado para /servicio: el bloque traía datos fijos de ejemplo y usaba
// @iconify/react para los iconos (dependencia que no usa el resto de la app) — aquí
// `data` viene del padre, la barra resaltada es la de mayor valor y los dos totales
// llevan iconos de lucide-react. Estilo (barras de 30 px con esquinas de 8, las demás al
// 20 % de opacidad, totales con icono en cuadro tintado) sin tocar. Ver
// components/nova/README.md.
export interface Chart12Datum {
  label: string;
  value: number;
}

const Charts12 = ({
  className,
  title = "Employee Salary",
  description = "Every month",
  data,
  serieLabel = "Total",
}: {
  className?: string;
  title?: string;
  description?: string;
  data: Chart12Datum[];
  serieLabel?: string;
}) => {
  const chartConfig = {
    value: { label: serieLabel, color: "var(--color-blue-500)" },
  } satisfies ChartConfig;

  const total = data.reduce((s, d) => s + d.value, 0);
  const principal = data.reduce<Chart12Datum | null>((m, d) => (!m || d.value > m.value ? d : m), null);

  return (
    <Card className={className}>
      <CardHeader className="px-0">
        <CardTitle className="text-foreground text-lg font-medium">{title}</CardTitle>
        <CardDescription className="text-sm text-muted-foreground font-normal">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div>
          <ChartContainer config={chartConfig} className="h-71.25 w-full">
            <BarChart accessibilityLayer data={data} barSize={30} barGap={0} barCategoryGap="40%">
              <XAxis dataKey="label" axisLine={false} tickLine={false} tickFormatter={(value) => value} />
              <YAxis hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel indicator="line" />} />
              <Bar dataKey="value" radius={[8, 8, 8, 8]}>
                {data.map((entry) => (
                  <Cell
                    key={entry.label}
                    fillOpacity={entry.label === principal?.label ? 1 : 0.2}
                    fill="var(--color-blue-500)"
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
        <div className="flex items-center gap-8 mt-6">
          <div className="flex gap-3 items-center">
            <div className="bg-blue-500/10 h-10 w-10 flex justify-center items-center rounded-md">
              <Grip className="text-blue-500 size-5" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Total</p>
              <h6 className="text-base text-foreground font-semibold">{total.toLocaleString("es-ES")}</h6>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <div className="bg-muted h-10 w-10 flex justify-center items-center rounded-md">
              <TriangleAlert className="opacity-70 dark:opacity-100 size-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Más frecuente</p>
              <h6 className="text-base text-foreground font-semibold">{principal?.label ?? "—"}</h6>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default Charts12;
