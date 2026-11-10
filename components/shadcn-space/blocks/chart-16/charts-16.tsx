"use client";

import type { ReactNode } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/nova/ui/card";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from "recharts";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/nova/ui/chart";

// Chart 16 de ShadcnSpace (Revenue Forecast) parametrizado para /servicio: el bloque
// original traía datos y tres series fijas (2024/2025/2026). Aquí `data` y `series`
// vienen del padre (una serie por canal), `objetivo` dibuja una línea de referencia y el
// eje Y/tooltip van en %. Cambios de estilo respecto al bloque (petición de «más
// redondeado y limpio»): tarjeta rounded-2xl sin sombra, rejilla solo horizontal y tenue
// (la misma que chart-01), curvas monotone sin puntos con degradado, marcas del eje Y de
// 10 en 10, margen izquierdo 0 en vez de -20 (para que no se corte «100%») y sin el icono
// de la cabecera. Ver components/nova/README.md.
export interface Chart16Serie {
    key: string;
    label: string;
    color: string;
}

export interface Chart16Datum {
    month: string;
    [serie: string]: string | number | null;
}

const Charts16 = ({
    className,
    title = "Revenue Forecast",
    description = "Overview of Profit",
    data,
    series,
    objetivo,
    domain = [0, 100],
    valueSuffix = "%",
    accion,
}: {
    className?: string;
    title?: string;
    description?: string;
    data: Chart16Datum[];
    series: Chart16Serie[];
    objetivo?: number;
    accion?: ReactNode; // acción opcional en la cabecera (p. ej. el botón «Compartir» de components/nova/compartir.tsx)
    domain?: [number, number];
    valueSuffix?: string;
}) => {
    const chartConfig = Object.fromEntries(
        series.map((s) => [s.key, { label: s.label, color: s.color }])
    ) satisfies ChartConfig;

    return (
        <Card className={`rounded-2xl ${className ?? ""}`}>
            <CardHeader className="flex flex-wrap items-center justify-between px-6">
                <div>
                    <CardTitle className="text-lg font-semibold">{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 md:mt-0">
                    {series.map((s) => (
                        <LegendDot key={s.key} color={s.color} label={s.label} />
                    ))}
                    {accion}
                </div>
            </CardHeader>

            <CardContent className="space-y-4  px-6">
                <ChartContainer config={chartConfig} className="h-[310px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 16, left: 0, right: 8 }}>
                            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(144, 164, 174, 0.3)" />
                            <defs>
                                {series.map((s) => (
                                    <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                                    </linearGradient>
                                ))}
                            </defs>
                            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={10} fontSize={12} />
                            <YAxis
                                domain={domain}
                                padding={{ top: 12 }}
                                ticks={Array.from({ length: Math.floor((domain[1] - domain[0]) / 10) + 1 }, (_, i) => domain[0] + i * 10)}
                                tickLine={false}
                                axisLine={false}
                                tickMargin={10}
                                fontSize={12}
                                tickFormatter={(v) => `${v}${valueSuffix}`}
                            />

                            <ChartTooltip content={<ChartTooltipContent />} />
                            {objetivo !== undefined && (
                                <ReferenceLine y={objetivo} stroke="rgba(144, 164, 174, 0.9)" strokeWidth={1} strokeDasharray="3 3" />
                            )}

                            {series.map((s) => (
                                <Area
                                    key={s.key}
                                    type="monotone"
                                    dataKey={s.key}
                                    stroke={s.color}
                                    fill={`url(#fill-${s.key})`}
                                    strokeWidth={2.5}
                                    strokeLinecap="round"
                                    dot={false}
                                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                                    connectNulls
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                </ChartContainer>
            </CardContent>
        </Card>
    );
};

const LegendDot = ({ color, label }: { color: string; label: string }) => (
    <div className="flex items-center gap-1.5 text-sm">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-muted-foreground">{label}</span>
    </div>
);

export default Charts16;
