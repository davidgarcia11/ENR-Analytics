"use client"

import * as React from "react"
import { BookmarkCheck, Calendar, Pencil, Save, Trash2, X } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

export type Preset = { id: number; name: string; filters: string; created_at: string }

/**
 * usePresets — carga y mantiene la lista de presets de un panel.
 * Se comparte entre `<PresetPanel>` (gestión completa) y `<PresetQuickSelect>`
 * (desplegable rápido en la barra de filtros) para que ambos vean siempre
 * la misma lista sin duplicar el fetch ni desincronizarse tras guardar/borrar.
 *
 * @example
 * const { presets, reload } = usePresets("caducados")
 * <PresetQuickSelect presets={presets} onSelect={p => applyFilters(JSON.parse(p.filters))} />
 * <PresetPanel screen="caducados" presets={presets} onReload={reload} ... />
 */
export function usePresets(screen: string) {
    const [presets, setPresets] = React.useState<Preset[]>([])

    const reload = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/presets?screen=${screen}`)
            if (res.ok) setPresets(await res.json())
        } catch { /* silencioso: igual que el comportamiento original */ }
    }, [screen])

    React.useEffect(() => { reload() }, [reload])

    return { presets, reload }
}

/**
 * PresetQuickSelect — desplegable de carga inmediata en la barra de acciones,
 * junto a los botones Filtrar/Excel/Limpiar. Complementa a `<PresetPanel>`
 * (que requiere abrir el panel) para cargar un preset guardado en un solo paso.
 * No se renderiza si no hay presets guardados.
 *
 * @example
 * <PresetQuickSelect presets={presets} onSelect={p => applyFilters(JSON.parse(p.filters))} />
 */
export function PresetQuickSelect({
    presets,
    onSelect,
    className,
}: {
    presets: Preset[]
    onSelect: (preset: Preset) => void
    className?: string
}) {
    if (presets.length === 0) return null
    return (
        <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-secondary-foreground">Cargar preset</label>
            <select
                onChange={(e) => {
                    const p = presets.find((pp) => pp.id === Number(e.target.value))
                    if (p) onSelect(p)
                    e.target.value = ""
                }}
                defaultValue=""
                className={cn("flex h-9 w-[160px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm", className)}
            >
                <option value="" disabled>Seleccionar...</option>
                {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
        </div>
    )
}

/**
 * PresetPanel — panel "Mis Presets de Filtros" compartido por todos los paneles.
 * Centraliza el guardado/edición/borrado y las llamadas a /api/presets que antes
 * estaban cuadruplicadas (caducados, pedidos, comparativa, producción).
 *
 * La lista de presets se recibe por props (ver `usePresets`) en vez de gestionarse
 * internamente, para poder compartirla con `<PresetQuickSelect>` en la misma página.
 * La página solo aporta la serialización de sus filtros:
 * - `getFilters`   → objeto con los filtros actuales (se guarda como JSON)
 * - `applyFilters` → recibe el objeto parseado al cargar un preset
 *
 * Mejoras sobre el original (comportamiento funcional idéntico):
 * errores por toast en vez de alert() y confirmación antes de borrar.
 *
 * @param screen     Identificador del panel en la API (ej. "caducados").
 * @param open       Visibilidad controlada por la página (botón Presets del Navbar).
 * @param hint       Texto de ayuda bajo el guardado (qué campos incluye el preset).
 * @param dateFields Nombres de campos de fecha en `getFilters()` (ej. `['startDate','endDate']`).
 *                   Si se pasa, aparece el checkbox "Incluir fechas" (igual que en producción/FilterPanel):
 *                   desmarcado por defecto, así el preset sirve para cualquier día salvo que se marque
 *                   explícitamente. Al editar un preset que ya tenía fechas, se premarca solo. Si no se
 *                   pasa (paneles sin fechas, ej. caducados), no cambia nada del comportamiento anterior.
 *
 * @example
 * const { presets, reload } = usePresets("caducados")
 * <PresetPanel
 *   screen="caducados"
 *   presets={presets}
 *   onReload={reload}
 *   open={showPresets}
 *   onClose={() => setShowPresets(false)}
 *   getFilters={() => ({ type: selectedType, selectedPlants })}
 *   applyFilters={(f) => { setSelectedType(f.type || 'todos'); setSelectedPlants(f.selectedPlants || []) }}
 *   hint="Se guardarán el tipo y las plantas seleccionadas."
 * />
 */
export function PresetPanel({
    screen,
    presets,
    onReload,
    open,
    onClose,
    getFilters,
    applyFilters,
    hint,
    dateFields,
}: {
    screen: string
    presets: Preset[]
    onReload: () => void
    open: boolean
    onClose: () => void
    getFilters: () => Record<string, unknown>
    applyFilters: (filters: Record<string, unknown>) => void
    hint?: string
    dateFields?: string[]
}) {
    const { toast } = useToast()
    const [presetName, setPresetName] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const [editingId, setEditingId] = React.useState<number | null>(null)
    const [deleteTarget, setDeleteTarget] = React.useState<Preset | null>(null)
    const [includeDates, setIncludeDates] = React.useState(false)

    const hasDateFields = !!dateFields && dateFields.length > 0
    const presetHasDates = (preset: Preset) => {
        if (!hasDateFields) return false
        try {
            const f = JSON.parse(preset.filters)
            return dateFields!.some((k) => f[k] != null && f[k] !== "")
        } catch {
            return false
        }
    }

    const cancelEdit = () => {
        setEditingId(null)
        setPresetName("")
        setIncludeDates(false)
    }

    const savePreset = async () => {
        const name = presetName.trim()
        if (!name) return
        setSaving(true)
        try {
            const isEditing = editingId !== null
            const filters = getFilters()
            if (hasDateFields && !includeDates) {
                for (const k of dateFields!) delete filters[k]
            }
            const res = await fetch(isEditing ? `/api/presets/${editingId}` : "/api/presets", {
                method: isEditing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, filters, screen }),
            })
            if (res.ok) {
                cancelEdit()
                onReload()
                toast(isEditing ? "Preset actualizado" : "Preset guardado", "success")
            } else {
                const data = await res.json()
                toast(data.error || "Error al guardar el preset", "error")
            }
        } finally {
            setSaving(false)
        }
    }

    const loadPreset = (preset: Preset) => {
        applyFilters(JSON.parse(preset.filters))
        onClose()
    }

    const startEdit = (preset: Preset) => {
        setPresetName(preset.name)
        setEditingId(preset.id)
        setIncludeDates(presetHasDates(preset))
        applyFilters(JSON.parse(preset.filters))
    }

    const deletePreset = async (id: number) => {
        await fetch(`/api/presets/${id}`, { method: "DELETE" })
        if (editingId === id) cancelEdit()
        onReload()
        toast("Preset eliminado", "success")
    }

    if (!open) return null

    return (
        <Card accent className="p-4">
            <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-secondary-foreground">
                    <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                    Mis Presets de Filtros
                </h3>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label="Cerrar presets"
                    onClick={() => { onClose(); cancelEdit() }}
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </Button>
            </div>

            {/* Guardar filtros actuales */}
            <div className="mb-4 rounded-lg border border-border bg-muted/50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {editingId ? "Editando preset" : "Guardar filtros actuales como preset"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="Escribe un nombre..."
                        className="h-9 max-w-[220px] bg-card text-sm"
                        onKeyDown={(e) => e.key === "Enter" && savePreset()}
                    />
                    {hasDateFields && (
                        <label className="flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs text-secondary-foreground">
                            <input
                                type="checkbox"
                                checked={includeDates}
                                onChange={(e) => setIncludeDates(e.target.checked)}
                                className="rounded border-input"
                            />
                            Incluir fechas
                        </label>
                    )}
                    <Button
                        onClick={savePreset}
                        disabled={saving || !presetName.trim()}
                        size="sm"
                        className={cn("h-9 px-4 text-xs font-semibold", editingId && "bg-info hover:bg-info/90")}
                    >
                        <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {editingId ? "Actualizar" : "Guardar"}
                    </Button>
                    {editingId && (
                        <Button onClick={cancelEdit} variant="outline" size="sm" className="h-9 text-xs text-muted-foreground">
                            Cancelar
                        </Button>
                    )}
                </div>
                {!editingId && hint && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
                )}
            </div>

            {/* Presets guardados */}
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Presets guardados
            </p>
            {presets.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tienes presets guardados.</p>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {presets.map((p) => (
                        <div
                            key={p.id}
                            className={cn(
                                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm",
                                editingId === p.id ? "border-blue-300 bg-blue-50" : "border-border bg-muted/50"
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => loadPreset(p)}
                                className="flex items-center gap-1.5 font-medium text-secondary-foreground hover:text-foreground"
                                title="Cargar preset"
                                aria-label={`Cargar preset ${p.name}`}
                            >
                                {p.name}
                                {presetHasDates(p) && <Calendar className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />}
                            </button>
                            <button
                                type="button"
                                onClick={() => startEdit(p)}
                                className="text-muted-foreground/50 hover:text-info"
                                aria-label={`Editar preset ${p.name}`}
                            >
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                className="text-muted-foreground/50 hover:text-destructive"
                                aria-label={`Eliminar preset ${p.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmDialog
                open={deleteTarget !== null}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
                title="Eliminar preset"
                description={deleteTarget ? `Se eliminará el preset "${deleteTarget.name}". Esta acción no se puede deshacer.` : undefined}
                confirmLabel="Eliminar"
                destructive
                onConfirm={() => deleteTarget && deletePreset(deleteTarget.id)}
            />
        </Card>
    )
}
