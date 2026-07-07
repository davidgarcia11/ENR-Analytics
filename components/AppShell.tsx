"use client"

import * as React from "react"
import Navbar from "@/components/Navbar"
import { cn } from "@/lib/utils"

type NavbarProps = React.ComponentProps<typeof Navbar>

/**
 * PageHeader — cabecera de sección: título (h1), descripción y acciones.
 * Da orientación al usuario (hoy ninguna página tiene título visible).
 *
 * @example
 * <PageHeader title="Producción" description="Órdenes de fabricación y merma por planta" actions={<Button>Exportar</Button>} />
 */
export function PageHeader({
    title,
    description,
    actions,
    className,
}: {
    title: string
    description?: string
    actions?: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
            <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
                {description && <p className="text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    )
}

/**
 * AppShell — contenedor de página unificado para todos los paneles.
 * Monta la Navbar, el ancho máximo, el padding y la cabecera de sección,
 * eliminando las divergencias actuales (max-w-7xl / 5xl / 4xl según página).
 *
 * @param title/description/actions Se pasan a `PageHeader`; omite `title` para no renderizar cabecera.
 * @param width "default" (max-w-7xl, paneles de datos) o "narrow" (max-w-4xl, admin).
 * @param navbar Props que cada página ya pasa hoy a `<Navbar>` (currentPanel, user, onLogout...).
 *
 * @example
 * <AppShell navbar={{ currentPanel: "produccion", user, onLogout }} title="Producción">
 *   {contenido}
 * </AppShell>
 */
export function AppShell({
    navbar,
    title,
    description,
    actions,
    width = "default",
    children,
}: {
    navbar: NavbarProps
    title?: string
    description?: string
    actions?: React.ReactNode
    width?: "default" | "narrow"
    children: React.ReactNode
}) {
    return (
        <main className="min-h-screen bg-background p-4 md:p-8">
            <div
                className={cn(
                    "mx-auto space-y-6",
                    width === "narrow" ? "max-w-4xl" : "max-w-7xl"
                )}
            >
                <Navbar {...navbar} />
                {title && <PageHeader title={title} description={description} actions={actions} />}
                {children}
            </div>
        </main>
    )
}
