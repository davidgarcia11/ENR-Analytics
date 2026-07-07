"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Dialog — modal controlado sobre el elemento nativo `<dialog>`.
 * El navegador aporta gratis: focus trap, cierre con Escape y top-layer.
 *
 * @param open         Estado controlado de apertura.
 * @param onOpenChange Callback al cerrar (Escape, clic fuera, botón X).
 * @param title        Título del modal (encabezado accesible).
 * @param children     Contenido del cuerpo.
 * @param footer       Nodo opcional con las acciones (botones).
 *
 * @example
 * <Dialog open={open} onOpenChange={setOpen} title="Editar usuario" footer={<Button>Guardar</Button>}>
 *   <p>Contenido…</p>
 * </Dialog>
 */
function Dialog({
    open,
    onOpenChange,
    title,
    children,
    footer,
    className,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    children?: React.ReactNode
    footer?: React.ReactNode
    className?: string
}) {
    const ref = React.useRef<HTMLDialogElement>(null)

    // Sincroniza el estado controlado con el elemento nativo
    React.useEffect(() => {
        const dialog = ref.current
        if (!dialog) return
        if (open && !dialog.open) dialog.showModal()
        if (!open && dialog.open) dialog.close()
    }, [open])

    return (
        <dialog
            ref={ref}
            onClose={() => onOpenChange(false)}
            // Clic en el backdrop (el propio <dialog> es el target fuera del panel) → cerrar
            onClick={(e) => {
                if (e.target === ref.current) onOpenChange(false)
            }}
            className={cn(
                "m-auto w-full max-w-md rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl",
                "backdrop:bg-black/50",
                className
            )}
        >
            {/* Panel interior: evita que el clic dentro cuente como clic en backdrop */}
            <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="text-base font-semibold leading-none tracking-tight">{title}</h2>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-2 h-8 w-8"
                        onClick={() => onOpenChange(false)}
                        aria-label="Cerrar"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                </div>
                {children && <div className="mt-3 text-sm text-muted-foreground">{children}</div>}
                {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
            </div>
        </dialog>
    )
}

/**
 * ConfirmDialog — confirmación antes de acciones destructivas o importantes.
 * Sustituye a `confirm()`/borrados inmediatos.
 *
 * @param confirmLabel Texto del botón de confirmación (por defecto "Confirmar").
 * @param destructive  Si true, el botón de confirmar usa la variante destructiva.
 *
 * @example
 * <ConfirmDialog
 *   open={confirmOpen}
 *   onOpenChange={setConfirmOpen}
 *   title="Eliminar preset"
 *   description="Esta acción no se puede deshacer."
 *   destructive
 *   onConfirm={handleDelete}
 * />
 */
function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirmar",
    cancelLabel = "Cancelar",
    destructive = false,
    onConfirm,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: string
    confirmLabel?: string
    cancelLabel?: string
    destructive?: boolean
    onConfirm: () => void
}) {
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            footer={
                <>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {cancelLabel}
                    </Button>
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        onClick={() => {
                            onOpenChange(false)
                            onConfirm()
                        }}
                    >
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            {description}
        </Dialog>
    )
}

export { Dialog, ConfirmDialog }
