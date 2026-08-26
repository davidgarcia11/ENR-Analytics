"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { cn } from "@/lib/utils";

// Ya no es un gráfico de barras divergentes desde el centro: la referencia visual final
// es una lista de barras de progreso (pista + relleno desde la izquierda), no un chart
// con ejes. Mismo patrón que la barra de "Cumplimiento" de components/nova/hierarchical-table.tsx
// (divs + Tailwind, colores por token) — no tiene sentido forzarlo en Recharts si no hay
// datos plateados/ejes que dibujar.
// Datos de ejemplo por defecto (fallback si no se pasa `data`, ver
// components/nova/README.md — modo mock centralizado en /api/compras).
const defaultDeviationData = [
    { familia: "Tortilla", pct: 7.9 },
    { familia: "Pimiento asado", pct: 9.6 },
    { familia: "Preparados a base de patata", pct: 0.6 },
    { familia: "Migas", pct: -2.6 },
    { familia: "Verduras", pct: 11.7 },
    { familia: "Otros", pct: 10.5 },
];

export interface DeviationDatum {
    familia: string;
    pct: number | null;
}

export default function DeviationByFamilyChart({
    className,
    unit = "Unidades",
    data = defaultDeviationData,
}: {
    className?: string;
    unit?: string;
    data?: DeviationDatum[];
}) {
    const rows = data.filter((d): d is { familia: string; pct: number } => d.pct != null);
    const maxAbs = Math.max(...rows.map((d) => Math.abs(d.pct)), 1);

    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle className="text-lg font-medium text-foreground">
                    Desviación por familia
                </CardTitle>
                <p className="text-sm font-normal text-muted-foreground">
                    % sobre previsión · {unit}
                </p>
            </CardHeader>
            {/* flex-1 + justify-between: la Card se estira a la altura de Charts15
                (grid por defecto, sin items-start); en vez de dejar hueco muerto bajo
                la última familia cuando hay pocas, las filas se reparten para ocupar
                todo el alto disponible (gap-3 sigue siendo el mínimo entre filas). */}
            <CardContent className="flex flex-1 flex-col justify-between gap-3">
                {rows.map((d) => {
                    const positivo = d.pct >= 0;
                    // Divergente desde el centro (0): mitad izquierda para negativos (crece
                    // hacia la izquierda), mitad derecha para positivos (crece hacia la
                    // derecha). Escalado al máximo absoluto de la serie, cada mitad = maxAbs.
                    const anchoMitadPct = Math.max(3, (Math.abs(d.pct) / maxAbs) * 100);
                    return (
                        <div key={d.familia} className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-sm">
                                <span className="truncate font-medium text-foreground">{d.familia}</span>
                                <span
                                    className={cn(
                                        "shrink-0 tabular-nums font-medium",
                                        positivo ? "text-[color:var(--color-success)]" : "text-[color:var(--color-destructive)]"
                                    )}
                                >
                                    {positivo ? "+" : ""}
                                    {d.pct.toFixed(1)}%
                                </span>
                            </div>
                            <div className="relative h-1.5">
                                {/* Carril de fondo, ancho completo — sustituye a la línea de
                                    0: ya da la referencia visual del centro sin necesitar un
                                    marcador aparte. */}
                                <div className="absolute inset-0 rounded-full bg-muted" />
                                <div className="absolute inset-y-0 left-0 w-1/2 pr-px">
                                    {!positivo && (
                                        <div
                                            className="absolute inset-y-0 right-0 rounded-full bg-[color:var(--color-destructive)] opacity-80"
                                            style={{ width: `${anchoMitadPct}%` }}
                                        />
                                    )}
                                </div>
                                <div className="absolute inset-y-0 right-0 w-1/2 pl-px">
                                    {positivo && (
                                        <div
                                            className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--color-success)] opacity-80"
                                            style={{ width: `${anchoMitadPct}%` }}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
