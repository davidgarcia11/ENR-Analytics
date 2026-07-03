import * as React from "react"
import { cn } from "@/lib/utils"

// Componente Card (Tarjeta): Contenedor principal con borde, sombra y fondo blanco
// Funciona como una 'div' estilizada
// accent: añade el borde superior rojo corporativo (sello visual de las tarjetas del dashboard)
const Card = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { accent?: boolean }
>(({ className, accent = false, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            // Clases: bordes redondeados, borde fino, fondo blanco, sombra suave
            "rounded-xl border border-border bg-card text-card-foreground shadow-sm",
            accent && "overflow-hidden border-t-[3px] border-t-primary",
            className
        )}
        {...props}
    />
))
Card.displayName = "Card"

// Cabecera de la Tarjeta
const CardHeader = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("flex flex-col space-y-1.5 p-6", className)}
        {...props}
    />
))
CardHeader.displayName = "CardHeader"

// Título de la Tarjeta (h3)
const CardTitle = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h3
        ref={ref}
        className={cn("font-semibold leading-none tracking-tight", className)}
        {...props}
    />
))
CardTitle.displayName = "CardTitle"

// Contenido principal de la Tarjeta
const CardContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    // p-6: padding de 1.5rem, pt-0: quita padding superior para que se pegue al header
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
