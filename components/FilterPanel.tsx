"use client"

import { useState, useEffect, type Dispatch, type SetStateAction } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { Search, Download, X, Save, BookmarkCheck, Trash2, Pencil, Layers, Calendar, Loader2 } from "lucide-react"
import { DatePicker } from "@/components/DatePicker"
import { ConfirmDialog } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

// --- TIPOS ---

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface Preset { id: number; name: string; filters: string; created_at: string }
type CategoryOption = { id: string; description: string }

// Filtros serializados al guardar un preset (fechas/horas son opcionales según los checkboxes)
interface PresetFiltersData {
  plant: string; subLine: string
  selectedArticles: string[]; selectedPrp6: string[]; selectedSrp3: string[]; selectedSrp5: string[]
  selectedSrp2: string[]; selectedSrp1: string[]; selectedSrp4: string[]; selectedZe03: string[]
  selectedProdLines: string[]
  startDate?: string; endDate?: string; startTime?: string; endTime?: string
}

export interface AppliedFilters {
  plant: string; subLine: string
  startDate: string; endDate: string
  startTime: string; endTime: string
  selectedArticles: string[]; selectedPrp6: string[]
  selectedSrp3: string[]; selectedSrp5: string[]
  selectedSrp2: string[]; selectedSrp1: string[]
  selectedSrp4: string[]; selectedZe03: string[]
  selectedProdLines: string[]
}

interface FilterPanelProps {
  sessionUser: SessionUser | null
  // Artículos disponibles vienen del Dashboard (se actualizan tras cada búsqueda)
  availableArticles: { id: string; description: string }[]
  loading: boolean        // para deshabilitar el botón Filtrar mientras carga
  dataLength: number      // para deshabilitar el botón Excel si no hay datos
  groupByArticle: boolean
  onApply: (filters: AppliedFilters) => void
  onExcel: () => void
  onGroupByArticleChange: (value: boolean) => void
  // Señal del header para abrir el panel de presets (se incrementa al pulsar el botón)
  openPresetsSignal?: number
}

// --- COMPONENTE ---

export function FilterPanel({
  sessionUser, availableArticles, loading, dataLength,
  groupByArticle, onApply, onExcel, onGroupByArticleChange,
  openPresetsSignal,
}: FilterPanelProps) {

  const { toast } = useToast()

  // Fecha de hoy para inicializar y limpiar filtros
  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // --- ESTADO DRAFT DE FILTROS ---
  // Este estado vive aquí dentro. Los cambios solo re-renderizan FilterPanel,
  // no el Dashboard (que tiene la tabla y las métricas). El Dashboard solo
  // recibe los filtros cuando el usuario pulsa "Filtrar" via onApply().

  const [filters, setFilters] = useState({
    plant: "all", subLine: "all",
    startDate: todayStr, endDate: todayStr,
    startTime: "", endTime: "",
  })

  const [selectedArticles, setSelectedArticles] = useState<string[]>([])
  const [selectedPrp6,     setSelectedPrp6]     = useState<string[]>([])
  const [selectedSrp3,     setSelectedSrp3]     = useState<string[]>([])
  const [selectedSrp5,     setSelectedSrp5]     = useState<string[]>([])
  const [selectedSrp2,     setSelectedSrp2]     = useState<string[]>([])
  const [selectedSrp1,     setSelectedSrp1]     = useState<string[]>([])
  const [selectedSrp4,     setSelectedSrp4]     = useState<string[]>([])
  const [selectedZe03,     setSelectedZe03]     = useState<string[]>([])
  const [selectedProdLines, setSelectedProdLines] = useState<string[]>([])

  // --- OPCIONES DE CATEGORÍA (se cargan una vez al montar) ---

  const [availablePrp6,      setAvailablePrp6]      = useState<{ id: string; description: string }[]>([])
  const [availableSrp3,      setAvailableSrp3]      = useState<{ id: string; description: string }[]>([])
  const [availableSrp5,      setAvailableSrp5]      = useState<{ id: string; description: string }[]>([])
  const [availableSrp2,      setAvailableSrp2]      = useState<{ id: string; description: string }[]>([])
  const [availableSrp1,      setAvailableSrp1]      = useState<{ id: string; description: string }[]>([])
  const [availableSrp4,      setAvailableSrp4]      = useState<{ id: string; description: string }[]>([])
  const [availableZe03,      setAvailableZe03]      = useState<{ id: string; description: string }[]>([])
  const [availableProdLines, setAvailableProdLines] = useState<{ id: string; description: string }[]>([])

  useEffect(() => {
    const fields:  string[]   = ['prp6', 'srp3', 'srp5', 'srp2', 'srp1', 'srp4', 'ze03']
    const setters: Dispatch<SetStateAction<CategoryOption[]>>[] = [
      setAvailablePrp6, setAvailableSrp3, setAvailableSrp5,
      setAvailableSrp2, setAvailableSrp1, setAvailableSrp4, setAvailableZe03,
    ]
    fields.forEach((field, i) =>
      fetch(`/api/categories?field=${field}`)
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setters[i](data) })
        .catch(console.error)
    )
    fetch('/api/production-lines')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableProdLines(data) })
      .catch(console.error)
  }, [])

  // --- PRESETS ---

  const [presets,            setPresets]            = useState<Preset[]>([])
  const [showPresets,        setShowPresets]        = useState(false)
  const [presetName,         setPresetName]         = useState("")
  const [savingPreset,       setSavingPreset]       = useState(false)
  const [includePresetDates, setIncludePresetDates] = useState(false)
  const [includePresetTimes, setIncludePresetTimes] = useState(false)
  const [editingPresetId,    setEditingPresetId]    = useState<number | null>(null)

  useEffect(() => {
    if (sessionUser) loadPresets()
    else setPresets([])
  }, [sessionUser])

  // Abre el panel de presets cuando el header envía una señal (botón "Presets")
  useEffect(() => {
    if ((openPresetsSignal ?? 0) > 0) setShowPresets(true)
  }, [openPresetsSignal])

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/presets')
      if (res.ok) setPresets(await res.json())
    } catch { /* silencioso */ }
  }

  const savePreset = async (nameOverride?: string) => {
    const name = nameOverride || presetName
    if (!name.trim()) return
    setSavingPreset(true)
    try {
      const filtersData: PresetFiltersData = {
        plant: filters.plant, subLine: filters.subLine,
        selectedArticles, selectedPrp6, selectedSrp3, selectedSrp5,
        selectedSrp2, selectedSrp1, selectedSrp4, selectedZe03, selectedProdLines,
      }
      if (includePresetDates) { filtersData.startDate = filters.startDate; filtersData.endDate = filters.endDate }
      if (includePresetTimes) { filtersData.startTime = filters.startTime; filtersData.endTime = filters.endTime }

      const isEditing = editingPresetId !== null
      const res = await fetch(isEditing ? `/api/presets/${editingPresetId}` : '/api/presets', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters: filtersData }),
      })
      if (res.ok) {
        setPresetName(''); setEditingPresetId(null)
        setIncludePresetDates(false); setIncludePresetTimes(false)
        loadPresets()
        toast(editingPresetId !== null ? 'Preset actualizado' : 'Preset guardado', 'success')
      } else {
        const data = await res.json()
        toast(data.error || 'Error al guardar el preset', 'error')
      }
    } finally { setSavingPreset(false) }
  }

  const startEditPreset = (preset: Preset) => {
    const f = JSON.parse(preset.filters)
    setPresetName(preset.name); setEditingPresetId(preset.id)
    setIncludePresetDates(!!f.startDate && !!f.endDate)
    setIncludePresetTimes(!!f.startTime || !!f.endTime)
    loadPreset(preset); setShowPresets(true)
  }

  const cancelEditPreset = () => {
    setEditingPresetId(null); setPresetName('')
    setIncludePresetDates(false); setIncludePresetTimes(false)
  }

  const loadPreset = (preset: Preset) => {
    const f = JSON.parse(preset.filters)
    setFilters(prev => ({
      plant: f.plant || 'all', subLine: f.subLine || 'all',
      startDate: f.startDate || prev.startDate,
      endDate:   f.endDate   || prev.endDate,
      startTime: f.startTime || "",
      endTime:   f.endTime   || "",
    }))
    setSelectedArticles(f.selectedArticles  || [])
    setSelectedPrp6(    f.selectedPrp6      || [])
    setSelectedSrp3(    f.selectedSrp3      || [])
    setSelectedSrp5(    f.selectedSrp5      || [])
    setSelectedSrp2(    f.selectedSrp2      || [])
    setSelectedSrp1(    f.selectedSrp1      || [])
    setSelectedSrp4(    f.selectedSrp4      || [])
    setSelectedZe03(    f.selectedZe03      || [])
    setSelectedProdLines(f.selectedProdLines || [])
    setShowPresets(false)
  }

  // Preset pendiente de confirmación de borrado (abre el ConfirmDialog)
  const [deleteTarget, setDeleteTarget] = useState<Preset | null>(null)

  const deletePreset = async (id: number) => {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    if (editingPresetId === id) cancelEditPreset()
    loadPresets()
    toast('Preset eliminado', 'success')
  }

  // --- ACCIONES DE FILTRO ---

  const handlePlantChange = (plantValue: string) => {
    let newSubLine = 'all'
    if (plantValue === '10100') newSubLine = '1'
    else if (plantValue === '10200') newSubLine = '2'
    setFilters(prev => ({ ...prev, plant: plantValue, subLine: newSubLine }))
  }

  const clearFilters = () => {
    setFilters({ plant: "all", subLine: "all", startDate: todayStr, endDate: todayStr, startTime: "", endTime: "" })
    setSelectedArticles([]); setSelectedPrp6([]);  setSelectedSrp3([])
    setSelectedSrp5([]);     setSelectedSrp2([]);  setSelectedSrp1([])
    setSelectedSrp4([]);     setSelectedZe03([]); setSelectedProdLines([])
  }

  const handleApply = () => {
    onApply({
      plant: filters.plant, subLine: filters.subLine,
      startDate: filters.startDate, endDate: filters.endDate,
      startTime: filters.startTime, endTime: filters.endTime,
      selectedArticles, selectedPrp6, selectedSrp3, selectedSrp5,
      selectedSrp2, selectedSrp1, selectedSrp4, selectedZe03, selectedProdLines,
    })
  }

  // --- RENDER ---

  return (
    <>
      {/* Panel de Presets (solo si logueado y abierto) */}
      {sessionUser && showPresets && (
        <div className="bg-card rounded-xl shadow-sm border border-border border-t-[3px] border-t-primary overflow-hidden p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
              <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              Mis Presets de Filtros
            </h3>
            <button type="button" aria-label="Cerrar presets" onClick={() => { setShowPresets(false); cancelEditPreset() }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Guardar filtros actuales */}
          <div className="bg-muted/50 rounded-lg p-3 mb-4 border border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {editingPresetId ? 'Editando preset' : 'Guardar filtros actuales como preset'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                placeholder="Escribe un nombre..."
                className="h-9 text-sm max-w-[220px] bg-card"
                onKeyDown={e => e.key === 'Enter' && savePreset()}
              />
              <label className="flex items-center gap-1.5 text-xs text-secondary-foreground cursor-pointer whitespace-nowrap select-none">
                <input type="checkbox" checked={includePresetDates} onChange={e => setIncludePresetDates(e.target.checked)} className="rounded border-input" />
                Incluir fechas
              </label>
              <label className="flex items-center gap-1.5 text-xs text-secondary-foreground cursor-pointer whitespace-nowrap select-none">
                <input type="checkbox" checked={includePresetTimes} onChange={e => setIncludePresetTimes(e.target.checked)} className="rounded border-input" />
                Incluir horas
              </label>
              <Button
                onClick={() => savePreset()}
                disabled={savingPreset || !presetName.trim()}
                size="sm"
                className={cn("text-xs font-semibold h-9 px-4", editingPresetId && "bg-info hover:bg-info/90")}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {editingPresetId ? 'Actualizar' : 'Guardar'}
              </Button>
              {editingPresetId && (
                <Button onClick={cancelEditPreset} variant="outline" size="sm" className="text-xs h-9 text-muted-foreground">
                  Cancelar
                </Button>
              )}
            </div>
            {!editingPresetId && (
              <p className="text-xs text-muted-foreground mt-1.5">Se guardarán los filtros de categoría, planta y sub-planta seleccionados actualmente.</p>
            )}
          </div>

          {/* Presets guardados */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Presets guardados</p>
          {presets.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tienes presets guardados.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {presets.map(p => {
                const pf = (() => { try { return JSON.parse(p.filters) } catch { return {} } })()
                const hasDates = !!pf.startDate && !!pf.endDate
                return (
                  <div key={p.id} className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm ${editingPresetId === p.id ? 'bg-blue-50 border-blue-300' : 'bg-muted/50 border-border'}`}>
                    <button type="button" onClick={() => loadPreset(p)} className="font-medium text-secondary-foreground hover:text-foreground flex items-center gap-1.5" title="Cargar preset" aria-label={`Cargar preset ${p.name}`}>
                      {p.name}
                      {hasDates && <Calendar className="h-3 w-3 text-muted-foreground/50" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => startEditPreset(p)} className="text-muted-foreground/50 hover:text-info" aria-label={`Editar preset ${p.name}`}>
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(p)} className="text-muted-foreground/50 hover:text-destructive" aria-label={`Eliminar preset ${p.name}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <ConfirmDialog
            open={deleteTarget !== null}
            onOpenChange={o => !o && setDeleteTarget(null)}
            title="Eliminar preset"
            description={deleteTarget ? `Se eliminará el preset "${deleteTarget.name}". Esta acción no se puede deshacer.` : undefined}
            confirmLabel="Eliminar"
            destructive
            onConfirm={() => deleteTarget && deletePreset(deleteTarget.id)}
          />
        </div>
      )}

      {/* Panel de Filtros */}
      <div className="bg-card p-4 rounded-xl shadow-sm border border-border border-t-[3px] border-t-primary overflow-hidden space-y-4">

        {/* Sección 1: Filtros de categoría */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Categorías</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Artículo</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableArticles} selected={selectedArticles} onChange={setSelectedArticles} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Tipo Proceso OF</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availablePrp6} selected={selectedPrp6} onChange={setSelectedPrp6} label="Tipo Proceso" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Formato</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp3} selected={selectedSrp3} onChange={setSelectedSrp3} label="Formato" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Sabor</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp5} selected={selectedSrp5} onChange={setSelectedSrp5} label="Sabor" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Familia</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp2} selected={selectedSrp2} onChange={setSelectedSrp2} label="Familia" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Categoría</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp1} selected={selectedSrp1} onChange={setSelectedSrp1} label="Categoría" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Marca</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp4} selected={selectedSrp4} onChange={setSelectedSrp4} label="Marca" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Gramaje</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableZe03} selected={selectedZe03} onChange={setSelectedZe03} label="Gramaje" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Línea Producción</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableProdLines} selected={selectedProdLines} onChange={setSelectedProdLines} label="Línea Producción" showId={false} />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Sección 2: Fechas, Horas y Planta */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Fechas y Planta</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Fecha Inicio</label>
              <DatePicker value={filters.startDate} onChange={v => setFilters({ ...filters, startDate: v })} className="w-[150px]" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Fecha Fin</label>
              <DatePicker value={filters.endDate} onChange={v => setFilters({ ...filters, endDate: v })} className="w-[150px]" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="filter-start-time" className="text-xs font-semibold text-secondary-foreground">Hora Inicio</label>
              <Input id="filter-start-time" type="time" step="1" value={filters.startTime} onChange={e => setFilters({ ...filters, startTime: e.target.value })} className="w-[145px] font-medium" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="filter-end-time" className="text-xs font-semibold text-secondary-foreground">Hora Fin</label>
              <Input id="filter-end-time" type="time" step="1" value={filters.endTime} onChange={e => setFilters({ ...filters, endTime: e.target.value })} className="w-[145px] font-medium" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="filter-plant" className="text-xs font-semibold text-secondary-foreground">Planta</label>
              <select
                id="filter-plant"
                className="flex h-9 w-[150px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-medium"
                value={filters.plant}
                onChange={e => handlePlantChange(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="10100">Aguilar</option>
                <option value="10200">Corella</option>
                <option value="10300">Funes</option>
              </select>
            </div>
            {(filters.plant === '10300' || filters.plant === 'all') && (
              <div className="grid gap-1.5 animate-in fade-in duration-300">
                <label htmlFor="filter-subline" className="text-xs font-semibold text-secondary-foreground">Sub-planta / Línea</label>
                <select
                  id="filter-subline"
                  className="flex h-9 w-[150px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-medium disabled:opacity-50"
                  value={filters.subLine}
                  onChange={e => setFilters({ ...filters, subLine: e.target.value })}
                  disabled={filters.plant !== '10300' && filters.plant !== 'all'}
                >
                  <option value="all">Todas</option>
                  {filters.plant === '10300' && (
                    <>
                      <option value="3">Funes 1</option>
                      <option value="4">Funes 2</option>
                      <option value="5">Funes Past.</option>
                    </>
                  )}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Sección 3: Acciones */}
        <div className="flex flex-wrap items-end gap-3 justify-end">
          <Button
            onClick={() => onGroupByArticleChange(!groupByArticle)}
            variant="outline"
            aria-pressed={groupByArticle}
            className={groupByArticle ? "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background font-semibold" : "text-secondary-foreground"}
          >
            <Layers className="mr-2 h-4 w-4" aria-hidden="true" />
            Agrupar por artículo
          </Button>
          <Button onClick={handleApply} disabled={loading} className="font-semibold">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}
            Filtrar
          </Button>
          <Button onClick={onExcel} variant="outline" disabled={dataLength === 0} className="border-green-600 text-green-700 hover:bg-green-50">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Excel
          </Button>
          <Button onClick={clearFilters} variant="outline" className="text-secondary-foreground">
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Limpiar
          </Button>

          {/* Presets rápidos (solo si logueado) */}
          {sessionUser && (
            <>
              {presets.length > 0 && (
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-secondary-foreground">Cargar preset</label>
                  <select
                    onChange={e => { const p = presets.find(p => p.id === Number(e.target.value)); if (p) loadPreset(p); e.target.value = '' }}
                    defaultValue=""
                    className="flex h-9 w-[160px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="" disabled>Seleccionar...</option>
                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <Button variant="outline" className="border-info/50 text-info hover:bg-blue-50" onClick={() => setShowPresets(true)}>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Guardar
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
