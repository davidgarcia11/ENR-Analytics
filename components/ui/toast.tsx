"use client"

import * as React from "react"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

type ToastVariant = "success" | "error" | "info"

type ToastItem = {
    id: number
    message: string
    variant: ToastVariant
}

type ToastContextValue = {
    /** Muestra una notificación no intrusiva. Se autodescarta a los 4 s. */
    toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

/**
 * useToast — hook para lanzar notificaciones desde cualquier componente cliente.
 * Requiere que la app esté envuelta en `<ToastProvider>` (ya montado en app/layout.tsx).
 *
 * @example
 * const { toast } = useToast()
 * toast("Preset guardado", "success")
 * toast("Error al guardar el preset", "error")
 */
export function useToast(): ToastContextValue {
    const ctx = React.useContext(ToastContext)
    if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>")
    return ctx
}

const VARIANT_STYLES: Record<ToastVariant, { icon: React.ElementType; classes: string }> = {
    success: { icon: CheckCircle2, classes: "border-green-200 bg-green-50 text-green-800" },
    error: { icon: AlertCircle, classes: "border-red-200 bg-red-50 text-red-800" },
    info: { icon: Info, classes: "border-blue-200 bg-blue-50 text-blue-800" },
}

/**
 * ToastProvider — mantiene la pila de toasts y la renderiza fija abajo a la derecha.
 * Región con `aria-live` para que los lectores de pantalla anuncien los mensajes.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = React.useState<ToastItem[]>([])
    const nextId = React.useRef(0)

    const dismiss = React.useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
    }, [])

    const toast = React.useCallback(
        (message: string, variant: ToastVariant = "info") => {
            const id = nextId.current++
            setToasts((prev) => [...prev, { id, message, variant }])
            setTimeout(() => dismiss(id), 4000)
        },
        [dismiss]
    )

    const value = React.useMemo(() => ({ toast }), [toast])

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div
                aria-live="polite"
                role="status"
                className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
            >
                {toasts.map(({ id, message, variant }) => {
                    const { icon: Icon, classes } = VARIANT_STYLES[variant]
                    return (
                        <div
                            key={id}
                            className={cn(
                                "pointer-events-auto flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg",
                                classes
                            )}
                        >
                            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <p className="flex-1">{message}</p>
                            <button
                                onClick={() => dismiss(id)}
                                aria-label="Cerrar notificación"
                                className="shrink-0 opacity-60 hover:opacity-100"
                            >
                                <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>
                    )
                })}
            </div>
        </ToastContext.Provider>
    )
}
