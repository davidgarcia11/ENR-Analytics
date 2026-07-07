import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * KpiCard — tarjeta de métrica del dashboard (borde superior rojo corporativo,
 * icono, valor grande y caption). Sustituye las cards KPI repetidas inline.
 *
 * Para cuerpos complejos (varias filas, colores condicionales) usa `children`
 * en lugar de `value`/`caption`.
 *
 * @example
 * <KpiCard title="Órdenes" icon={Calendar} value={metrics.totalOrders} caption="Total de órdenes (cargadas)" />
 *
 * @example
 * <KpiCard title="Merma" icon={Factory}>
 *   <div className="text-2xl font-black text-green-600">1,25%</div>
 * </KpiCard>
 */
export function KpiCard({
    title,
    icon: Icon,
    iconClassName,
    value,
    caption,
    children,
    className,
}: {
    title: string
    icon?: LucideIcon
    /** Color del icono; por defecto rojo corporativo. Útil para KPIs con semántica de estado. */
    iconClassName?: string
    value?: React.ReactNode
    caption?: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <Card accent className={cn("shadow-sm", className)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold text-secondary-foreground">{title}</CardTitle>
                {Icon && <Icon className={cn("h-4 w-4", iconClassName ?? "text-primary")} aria-hidden="true" />}
            </CardHeader>
            <CardContent>
                {children ?? (
                    <>
                        <div className="text-2xl font-black text-foreground">{value}</div>
                        {caption && <p className="mt-1 text-xs font-medium text-muted-foreground">{caption}</p>}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
