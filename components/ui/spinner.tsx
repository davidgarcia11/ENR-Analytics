import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Spinner — indicador de carga unificado (Loader2 de lucide girando).
 *
 * @param label Texto accesible/visible opcional junto al icono.
 * @example
 * <Spinner />
 * <Spinner label="Cargando datos..." className="h-8" />
 */
function Spinner({
    label,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
    return (
        <div
            role="status"
            className={cn("flex items-center justify-center gap-2 text-muted-foreground", className)}
            {...props}
        >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Cargando</span>}
        </div>
    )
}

export { Spinner }
