import * as React from "react"
import { cn } from "@/lib/utils"

// Interfaz vacía que hereda todas las propiedades estándar de un <input> HTML
export interface InputProps
    extends React.InputHTMLAttributes<HTMLInputElement> { }

// Componente Input reutilizable
const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                // Clases de Tailwind enormes explicadas:
                // flex h-9 w-full: Ocupa todo el ancho, altura fija
                // rounded-md border: Bordes redondeados y línea de borde
                // bg-transparent: Fondo transparente
                // focus-visible:outline-none: Quita el borde azul feo por defecto del navegador
                // focus-visible:ring-1: Añade nuestro propio anillo de foco al clicar
                // disabled...: Estilos para cuando está deshabilitado
                className={cn(
                    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                ref={ref}
                {...props} // Pasa el resto de props (onChange, value, placeholder...)
            />
        )
    }
)
Input.displayName = "Input"

export { Input }
