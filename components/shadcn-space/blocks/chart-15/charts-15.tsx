"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/nova/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/nova/ui/chart";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

// Evolución mensual: Previsión (F3460) vs Real (F4211), barras agrupadas (no
// apiladas — el block original traía stackId pensado para series +/-, no para
// comparar dos magnitudes positivas lado a lado). `data` viene de /api/compras
// (mensual.total / mensual.porFamilia / mensual.porFamiliaCanal, ver
// components/nova/README.md) filtrado en la página según el nivel abierto (`drill`).
const defaultMonthlyData = [
    { month: "sep", previsto: 8100, real: 8600 },
    { month: "oct", previsto: 8700, real: 9300 },
    { month: "nov", previsto: 9400, real: 10800 },
    { month: "dic", previsto: 10600, real: 11200 },
    { month: "ene", previsto: 9700, real: 8300 },
    { month: "feb", previsto: 8200, real: 7300 },
    { month: "mar", previsto: 8600, real: 9200 },
    { month: "abr", previsto: 9300, real: 9800 },
    { month: "may", previsto: 10100, real: 10600 },
    { month: "jun", previsto: 10400, real: 10900 },
    { month: "jul", previsto: 9600, real: 9900 },
    { month: "ago", previsto: 9000, real: 8500 },
];

export interface MonthlyDatum {
    month: string;
    previsto: number;
    real: number;
}

const chartConfig = {
    previsto: {
        label: "Previsión",
        color: "var(--border)",
    },
    real: {
        label: "Real",
        color: "var(--foreground)",
    },
} satisfies ChartConfig;

const formatK = (value: number) =>
    value === 0 ? "0" : `${Math.round(value / 1000)}k`;

export default function Charts15({
    className,
    scope = "Todas las familias",
    unit = "Unidades",
    data = defaultMonthlyData,
}: {
    className?: string;
    scope?: string;
    unit?: string;
    data?: MonthlyDatum[];
}) {
    return (
        <Card className={className}>
            <CardHeader className="flex flex-wrap items-center justify-between">
                <div>
                    <CardTitle className="text-lg font-medium text-foreground">
                        Evolución mensual
                    </CardTitle>
                    <p className="text-sm font-normal text-muted-foreground">
                        {scope} · {unit}
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-sm">
                        <span className="h-2 w-2 rounded-full bg-border" />
                        <span className="text-muted-foreground">Previsión</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm">
                        <span className="h-2 w-2 rounded-full bg-foreground" />
                        <span className="text-muted-foreground">Real</span>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                    <BarChart data={data} barGap={6} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid
                            vertical={false}
                            stroke="var(--border)"
                            strokeOpacity={0.5}
                        />
                        <XAxis
                            dataKey="month"
                            axisLine={false}
                            tickLine={false}
                            tickMargin={12}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={formatK}
                        />
                        <ChartTooltip
                            content={<ChartTooltipContent />}
                            cursor={{ fill: "var(--muted)" }}
                        />
                        <Bar
                            dataKey="previsto"
                            fill="var(--color-previsto)"
                            radius={[4, 4, 0, 0]}
                            barSize={11}
                        />
                        <Bar
                            dataKey="real"
                            fill="var(--color-real)"
                            radius={[4, 4, 0, 0]}
                            barSize={11}
                        />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}
