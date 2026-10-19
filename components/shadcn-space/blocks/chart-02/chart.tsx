"use client";


import { Label, Pie, PieChart } from "recharts"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/nova/ui/card";
import { Badge } from "@/components/nova/ui/badge";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/nova/ui/chart"
import { cn } from "@/lib/utils";

// Chart 02 de ShadcnSpace (Earning Reports, donut con texto) parametrizado para
// /servicio: el bloque traía tres segmentos y cifras de ejemplo fijos. Aquí `data`
// viene del padre (nombre, valor, color), el centro muestra el total y la lista inferior
// el valor y el % de cada segmento (en lugar del % de crecimiento de ejemplo). Estilo
// sin tocar. Ver components/nova/README.md.
export interface Chart02Segmento {
    name: string;
    value: number;
    color: string;
}

export default function Chart02({
    title = "Earning Reports",
    description,
    centerLabel = "Total",
    data,
}: {
    title?: string;
    description?: string;
    centerLabel?: string;
    data: Chart02Segmento[];
}) {
    const total = data.reduce((s, d) => s + d.value, 0);
    const chartData = data.map((d, i) => ({ ...d, key: `s${i}`, fill: d.color }));
    const chartConfig = Object.fromEntries([
        ["value", { label: "Total" }],
        ...chartData.map((d) => [d.key, { label: d.name, color: d.color }]),
    ]) satisfies ChartConfig;

    return (
        <Card className="h-full w-full mx-auto py-6 gap-6 rounded-2xl">
            <CardHeader className="px-6">
                <CardTitle>
                    <h4 className="text-lg font-medium">{title}</h4>
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex flex-col justify-between gap-8 flex-1 px-6">
                <ChartContainer config={chartConfig} className="aspect-square max-h-50">
                    <PieChart margin={{ top: -20 }}>
                        <ChartTooltip
                            cursor={false}
                            content={<ChartTooltipContent hideLabel />}
                        />
                        <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="key"
                            innerRadius={68}
                            outerRadius={90}
                            cornerRadius={10}
                            paddingAngle={4}
                            strokeWidth={0}
                            startAngle={90}
                            endAngle={-270}
                        >
                            <Label
                                content={({ viewBox }) => {
                                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                        return (
                                            <text
                                                x={viewBox.cx}
                                                y={viewBox.cy}
                                                textAnchor="middle"
                                                dominantBaseline="middle"
                                            >
                                                <tspan
                                                    x={viewBox.cx}
                                                    y={(viewBox.cy || 0) - 10}
                                                    className="fill-muted-foreground text-sm"
                                                >
                                                    {centerLabel}
                                                </tspan>
                                                <tspan
                                                    x={viewBox.cx}
                                                    y={(viewBox.cy || 0) + 15}
                                                    className="fill-foreground text-xl font-medium"
                                                >
                                                    {total.toLocaleString("es-ES")}
                                                </tspan>
                                            </text>
                                        )
                                    }
                                }}
                            />
                        </Pie>
                    </PieChart>
                </ChartContainer>
                <div className="flex flex-col gap-3">
                    {data.map((item) => (
                        <div key={item.name} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-1 h-4 rounded-full" style={{ backgroundColor: item.color }}></div>
                                <h6 className={cn("text-sm font-normal leading-tight")}>
                                    {item.name}
                                </h6>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <h6 className="text-sm font-medium">{item.value.toLocaleString("es-ES")}</h6>
                                <Badge className="bg-teal-400/10 text-muted-foreground shadow-none">
                                    {total > 0 ? Math.round((item.value / total) * 100) : 0}%
                                </Badge>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
