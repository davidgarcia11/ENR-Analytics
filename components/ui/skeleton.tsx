import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Skeleton — bloque de carga con pulso.
 * Dimensiona con clases (`h-4 w-32`, `h-24 w-full`...).
 *
 * @example
 * <Skeleton className="h-4 w-48" />
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("animate-pulse rounded-md bg-muted", className)}
            aria-hidden="true"
            {...props}
        />
    )
}

export { Skeleton }
