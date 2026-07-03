"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type TabOption = {
    value: string
    label: React.ReactNode
    /** Contador opcional mostrado junto a la etiqueta (ej. nº de filas). */
    count?: number
}

/**
 * Tabs — lista de pestañas controlada, estilo subrayado (Notion/Linear).
 * Solo renderiza la barra de pestañas; el contenido lo decide la página
 * según `value` (mismo patrón que las tabs inline actuales de admin y comparativa).
 *
 * Accesibilidad: role tablist/tab, aria-selected y navegación con ← →.
 *
 * @example
 * <Tabs
 *   value={tab}
 *   onValueChange={setTab}
 *   tabs={[
 *     { value: "usuarios", label: "Usuarios", count: users.length },
 *     { value: "roles", label: "Roles" },
 *   ]}
 * />
 */
function Tabs({
    value,
    onValueChange,
    tabs,
    className,
}: {
    value: string
    onValueChange: (value: string) => void
    tabs: TabOption[]
    className?: string
}) {
    const listRef = React.useRef<HTMLDivElement>(null)

    // Navegación con flechas dentro del tablist
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
        e.preventDefault()
        const idx = tabs.findIndex((t) => t.value === value)
        const next =
            e.key === "ArrowRight"
                ? tabs[(idx + 1) % tabs.length]
                : tabs[(idx - 1 + tabs.length) % tabs.length]
        onValueChange(next.value)
        const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        buttons?.[tabs.indexOf(next)]?.focus()
    }

    return (
        <div
            ref={listRef}
            role="tablist"
            onKeyDown={onKeyDown}
            className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
        >
            {tabs.map((tab) => {
                const active = tab.value === value
                return (
                    <button
                        key={tab.value}
                        role="tab"
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onValueChange(tab.value)}
                        className={cn(
                            "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-t-md",
                            active
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                        )}
                    >
                        {tab.label}
                        {tab.count !== undefined && (
                            <span
                                className={cn(
                                    "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                                    active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                                )}
                            >
                                {tab.count}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

export { Tabs }
