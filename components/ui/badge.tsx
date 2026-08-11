import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Badge — etiqueta pequeña de estado o categoría.
 *
 * Variantes semánticas con fondo suave y texto oscuro (contraste AA):
 * - `default`  → neutro (gris)
 * - `primary`  → rojo corporativo suave
 * - `success`  → verde (estados correctos)
 * - `warning`  → ámbar (avisos)
 * - `destructive` → rojo (errores / bloqueos)
 * - `info`     → azul (informativo / edición)
 * - `outline`  → solo borde
 *
 * @example
 * <Badge variant="success">Activo</Badge>
 * <Badge variant="warning">Caduca pronto</Badge>
 */
const badgeVariants = cva(
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    {
        variants: {
            variant: {
                default: "border-transparent bg-muted text-secondary-foreground",
                primary: "border-transparent bg-primary/10 text-primary",
                success: "border-green-200 bg-green-50 text-green-700",
                warning: "border-amber-200 bg-amber-50 text-amber-700",
                destructive: "border-red-200 bg-red-50 text-red-700",
                info: "border-blue-200 bg-blue-50 text-blue-700",
                outline: "border-border bg-transparent text-foreground",
            },
        },
        defaultVariants: { variant: "default" },
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
