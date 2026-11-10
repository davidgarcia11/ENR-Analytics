"use client";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/nova/ui/card";
import type { ReactNode } from "react";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/nova/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

// Chart 01 de ShadcnSpace (Sales Overview, barras apiladas) parametrizado para
// /servicio: el bloque traía tres series fijas y una cifra de ejemplo con insignia de
// crecimiento. Aquí `data` y `series` vienen del padre (una serie por motivo), la cifra
// grande es `headline` y el eje Y se ajusta al máximo apilado. Estilo (cabecera,
// leyenda de puntos, rejilla punteada, barras de 20px con esquinas redondeadas)
// sin tocar. Ver components/nova/README.md.
export interface Chart01Serie {
    key: string;
    label: string;
    color: string;
}

export interface Chart01Datum {
    month: string;
    [serie: string]: string | number;
}

export default function Chart01({
    title = "Sales Overview",
    description,
    headline,
    data,
    series,
    accion,
}: {
    title?: string;
    description?: string;
    headline?: string;
    data: Chart01Datum[];
    series: Chart01Serie[];
    accion?: ReactNode; // acción opcional en la cabecera (p. ej. el botón «Compartir» de components/nova/compartir.tsx)
}) {
    const chartConfig = Object.fromEntries(
        series.map((s) => [s.key, { label: s.label, color: s.color }])
    ) satisfies ChartConfig;

    return (
        <Card className="w-full mx-auto py-6 gap-8 rounded-2xl">
            <CardHeader className="flex sm:flex-row flex-col justify-between sm:items-center items-start gap-3 px-6">
                <div className="flex flex-col gap-1">
                    <CardTitle className="text-lg font-medium">{title}</CardTitle>
                    {headline && (
                        <div className="flex items-center gap-2">
                            <h3 className="text-3xl font-medium text-card-foreground">{headline}</h3>
                            {description && <span className="text-xs text-muted-foreground">{description}</span>}
                        </div>
                    )}
                    {!headline && description && <CardDescription>{description}</CardDescription>}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    {series.map((item) => (
                        <div key={item.key} className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                            <p className="text-sm text-muted-foreground">{item.label}</p>
                        </div>
                    ))}
                    {accion}
                </div>
            </CardHeader>
            <CardContent className="px-6">
                <ChartContainer config={chartConfig} className="h-75 w-full">
                    <BarChart accessibilityLayer data={data} margin={{
                        left: -20,
                    }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(144, 164, 174, 0.3)" />
                        <XAxis
                            dataKey="month"
                            tickLine={false}
                            tickMargin={10}
                            axisLine={false}
                            fontSize={12}
                        />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickMargin={10}
                            fontSize={12}
                            allowDecimals={false}
                        />
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent indicator="line" />}
                        />
                        {series.map((s) => (
                            <Bar
                                key={s.key}
                                dataKey={s.key}
                                stackId="a"
                                fill={s.color}
                                radius={5}
                                stroke="var(--card)"
                                strokeWidth={2}
                                barSize={10}
                            />
                        ))}
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    );
}
