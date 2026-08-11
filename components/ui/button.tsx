import * as React from "react"
import { Slot } from "@radix-ui/react-slot" // Permite que el botón se comporte como su hijo (útil para tooltips o links)
import { cva, type VariantProps } from "class-variance-authority" // Librería para gestionar variantes de estilos (colores, tamaños)

import { cn } from "@/lib/utils"

// Definición de las variantes de estilos del botón usando 'cva'
// Esto nos permite usar <Button variant="destructive" size="sm"> de forma fácil
const buttonVariants = cva(
    // Clases base que tienen TODOS los botones (flexbox, centrado, bordes redondeados, transiciones...)
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            // Estilos según la variante (color/propósito)
            variant: {
                default:
                    "bg-primary text-primary-foreground shadow hover:bg-primary-hover", // El botón principal (rojo corporativo)
                destructive:
                    "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90", // Botón rojo de borrar/peligro
                outline:
                    "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground", // Borde fino, fondo blanco
                secondary:
                    "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80", // Secundario (gris claro)
                ghost: "hover:bg-accent hover:text-accent-foreground", // Transparente hasta que pasas el ratón
                link: "text-primary underline-offset-4 hover:underline", // Parece un enlace pero es un botón
            },
            // Estilos según el tamaño
            size: {
                default: "h-9 px-4 py-2", // Tamaño normal
                sm: "h-8 rounded-md px-3 text-xs", // Pequeño
                lg: "h-10 rounded-md px-8", // Grande
                icon: "h-9 w-9", // Cuadrado para iconos
            },
        },
        // Valores por defecto si no se especifica nada
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

// Interfaz de propiedades (Props) del botón
export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean // Si es true, renderiza el hijo en lugar de un <button> (Slot)
}

// El componente Botón en sí
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                // cn() combina las clases base + variantes + clases extra que pasemos (className)
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
