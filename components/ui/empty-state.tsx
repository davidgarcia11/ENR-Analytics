import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * EmptyState — estado vacío unificado para tablas y paneles.
 *
 * @param icon        Icono lucide opcional (se muestra atenuado).
 * @param title       Mensaje principal (ej. "Sin resultados").
 * @param description Detalle opcional (ej. "Prueba a cambiar los filtros").
 * @param action      Nodo opcional (ej. botón "Limpiar filtros").
 *
 * @example
 * <EmptyState icon={SearchX} title="Sin resultados" description="Prueba a cambiar los filtros" />
 */
function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    icon?: LucideIcon
    title: string
    description?: string
    action?: React.ReactNode
}) {
    return (
        <div
            className={cn("flex flex-col items-center justify-center gap-2 py-10 text-center", className)}
            {...props}
        >
            {Icon && <Icon className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />}
            <p className="text-sm font-medium text-foreground">{title}</p>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
            {action && <div className="mt-2">{action}</div>}
        </div>
    )
}

export { EmptyState }
