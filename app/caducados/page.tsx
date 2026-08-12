"use client"

import { useState, useEffect, useDeferredValue, useMemo, memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { Search, Loader2, Download, X, AlertTriangle, Package, MapPin, Lock, Save, SearchX } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { KpiCard } from "@/components/KpiCard"
import { PresetPanel, PresetQuickSelect, usePresets } from "@/components/PresetPanel"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"
import { plantJdeCode } from "@/lib/plants"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string; defaultPlant: string }
interface Plant { id: string; description: string }
interface LotState { code: string; description: string }
interface PaletRow {
  articleLong: string; description: string; plantCode: string; plantName: string;
  paletLote: string; palet: string; lote: string; location: string; quantity: number;
  expiryDate: string | null; motivo: string; lotStatus: string | null;
}
interface Summary {
  totalPallets: number; totalQuantity: number; caducados: number; obsoletos: number; bloqueados: number; ambos: number;
}

// Devuelve la variante semántica del Badge según el motivo del palet
function getMotivoBadgeProps(motivo: string): { variant: "default" | "destructive" | "warning" | "info" | "outline"; className: string } {
  if (motivo.includes('Caducado') && motivo.includes('+')) return { variant: 'destructive', className: 'font-bold' }
  if (motivo === 'Caducado') return { variant: 'destructive', className: 'font-semibold' }
  if (motivo === 'Obsoleto') return { variant: 'warning', className: 'font-semibold' }
  // Combinaciones de bloqueos (sin token semántico: se mantiene el morado original)
  if (motivo.includes('+')) return { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700 font-bold' }
  if (motivo !== 'Desconocido') return { variant: 'info', className: 'font-semibold' }
  return { variant: 'default', className: 'font-semibold' }
}

const CaducadosTable = memo(function CaducadosTable({ data, loading }: { data: PaletRow[]; loading: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-border hover:bg-transparent">
          <TableHead className="font-bold text-secondary-foreground">Articulo</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Descripcion</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Planta</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Ubicacion</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Palet</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Lote</TableHead>
          <TableHead className="text-right font-bold text-secondary-foreground">Cantidad</TableHead>
          <TableHead className="font-bold text-secondary-foreground">Fecha Cad.</TableHead>
          <TableHead className="font-bold text-secondary-foreground text-center whitespace-nowrap">Motivo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => (
          <TableRow key={i} className="hover:bg-muted/50 border-border">
            <TableCell className="text-secondary-foreground font-mono text-xs bg-muted px-2 py-1 rounded w-fit">{row.articleLong}</TableCell>
            <TableCell className="text-muted-foreground uppercase text-xs font-semibold">{row.description}</TableCell>
            <TableCell className="text-secondary-foreground text-sm">{row.plantName}</TableCell>
            <TableCell className="text-muted-foreground text-xs">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                {row.location || 'GENERICA'}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">{row.palet}</TableCell>
            <TableCell className="text-muted-foreground font-mono text-xs">{row.lote}</TableCell>
            <TableCell className="text-right font-bold text-foreground">
              {row.quantity.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
            </TableCell>
            <TableCell className="text-secondary-foreground text-sm">
              {row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('es-ES') : '-'}
            </TableCell>
            <TableCell className="text-center whitespace-nowrap">
              <Badge {...getMotivoBadgeProps(row.motivo)}>{row.motivo}</Badge>
            </TableCell>
          </TableRow>
        ))}

        {loading && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={9}>
              <Spinner label="Cargando..." className="py-10" />
            </TableCell>
          </TableRow>
        )}

        {!loading && data.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={9}>
              <EmptyState
                icon={SearchX}
                title="Sin resultados"
                description={'Pulsa "Filtrar" para buscar palets caducados u obsoletos.'}
              />
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
})

export default function CaducadosPage() {
  const router = useRouter()

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [data, setData] = useState<PaletRow[]>([])
  const [summary, setSummary] = useState<Summary>({ totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })
  const [loading, setLoading] = useState(false)
  const [plants, setPlants] = useState<Plant[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [availableLotStates, setAvailableLotStates] = useState<LotState[]>([])
  const [availableSrp1, setAvailableSrp1] = useState<{ id: string; description: string }[]>([])
  const [availableSrp2, setAvailableSrp2] = useState<{ id: string; description: string }[]>([])
  const [selectedSrp1, setSelectedSrp1] = useState<string[]>([])
  const [selectedSrp2, setSelectedSrp2] = useState<string[]>([])
  const [selectedPlants, setSelectedPlants] = useState<string[]>([])
  const [selectedLocations, setSelectedLocations] = useState<string[]>(['__blank__'])
  const [selectedType, setSelectedType] = useState<'todos' | 'caducados' | 'obsoletos' | 'bloqueados'>('todos')
  const [selectedLotStates, setSelectedLotStates] = useState<string[]>([])
  const [paletSearch, setPaletSearch] = useState('')
  const [loteSearch, setLoteSearch] = useState('')
  const [selectedArticles, setSelectedArticles] = useState<string[]>([])

  // --- PRESETS ---
  const [showPresets, setShowPresets] = useState(false)
  // Señal que dispara la apertura del panel de presets desde el botón del Navbar
  const [presetsSignal, setPresetsSignal] = useState(0)
  useEffect(() => {
    if (presetsSignal > 0) setShowPresets(true)
  }, [presetsSignal])
  // Artículos aplicados: solo se actualizan al pulsar "Filtrar" (igual que producción)
  const [appliedArticles, setAppliedArticles] = useState<string[]>([])

  // Artículos disponibles derivados de los datos cargados (sin consulta adicional)
  const availableArticles = useMemo(() => {
    const map = new Map<string, { id: string; description: string }>()
    data.forEach(row => {
      if (row.articleLong) map.set(row.articleLong, { id: row.articleLong, description: row.description })
    })
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id))
  }, [data])

  // Filtro cliente por artículo — solo se aplica tras pulsar "Filtrar"
  const filteredData = useMemo(() => {
    if (appliedArticles.length === 0) return data
    return data.filter(row => appliedArticles.includes(row.articleLong))
  }, [data, appliedArticles])

  // Métricas recalculadas cuando hay filtro por artículo aplicado
  const displaySummary = useMemo(() => {
    if (appliedArticles.length === 0) return summary
    let totalPallets = 0, totalQuantity = 0, caducados = 0, obsoletos = 0, bloqueados = 0, ambos = 0
    filteredData.forEach(row => {
      totalPallets++
      totalQuantity += row.quantity
      const isExp = row.motivo.includes('Caducado')
      const isObs = row.motivo.includes('Obsoleto')
      const isBlk = !!row.lotStatus
      if (isExp) caducados++
      if (isObs) obsoletos++
      if (isBlk) bloqueados++
      if ([isExp, isObs, isBlk].filter(Boolean).length > 1) ambos++
    })
    return { totalPallets, totalQuantity: Math.round(totalQuantity * 100) / 100, caducados, obsoletos, bloqueados, ambos }
  }, [filteredData, appliedArticles, summary])

  const deferredData = useDeferredValue(filteredData)

  // Espera a conocer la sesión antes de la primera consulta, para que ya venga
  // filtrada por la planta por defecto del usuario (si tiene una) y no se vea
  // primero "todas las plantas" y luego solo la suya.
  useEffect(() => {
    (async () => {
      const user = await checkSession()
      const code = plantJdeCode(user?.defaultPlant)
      const initialPlants = code ? [code] : []
      setSelectedPlants(initialPlants)
      fetchPlants()
      fetchData(initialPlants)
    })()
    fetchLotStates()
    fetchCategories()
  }, [])

  const fetchPlants = async () => {
    try {
      const res = await fetch('/api/plants?screen=caducados')
      if (res.ok) setPlants(await res.json())
    } catch { }
  }

  const fetchCategories = async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch('/api/categories?field=srp1&screen=caducados'),
        fetch('/api/categories?field=srp2&screen=caducados'),
      ])
      if (r1.ok) setAvailableSrp1(await r1.json())
      if (r2.ok) setAvailableSrp2(await r2.json())
    } catch { }
  }

  // Carga ligera: solo consulta F0005, sin ejecutar la query principal de stock
  const fetchLotStates = async () => {
    try {
      const res = await fetch('/api/caducados?onlyLotStates=1')
      if (!res.ok) return
      const json = await res.json()
      if (json.lotStates?.length > 0) setAvailableLotStates(json.lotStates)
    } catch { }
  }

  const checkSession = async (): Promise<SessionUser | null> => {
    try {
      const res = await fetch('/api/auth/me')
      let user = null
      if (res.ok) {
        user = await res.json()
        if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return null }
        setSessionUser(user)
      }
      const screensRes = await fetch('/api/screen-permissions')
      if (screensRes.ok) {
        const screens = await screensRes.json()
        const mine = screens['caducados']
        if (mine && !mine.is_public) {
          if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
            router.push('/login')
            return null
          }
        }
      }
      return user
    } catch { return null }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
  }

  // plantsOverride se usa solo en la carga inicial, cuando aún no ha dado tiempo
  // a que el estado selectedPlants recién fijado se refleje en este cierre (closure).
  const fetchData = async (plantsOverride?: string[]) => {
    // Aplicar el filtro de artículo al pulsar "Filtrar" (igual que producción)
    setAppliedArticles(selectedArticles)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      const plantsToUse = plantsOverride ?? selectedPlants
      plantsToUse.forEach(v => params.append('plant', v))
      selectedLocations.forEach(v => params.append('location', v))
      params.append('type', selectedType)
      selectedLotStates.forEach(v => params.append('lotStates', v))
      selectedSrp1.forEach(v => params.append('srp1', v))
      selectedSrp2.forEach(v => params.append('srp2', v))
      if (paletSearch.trim()) params.append('palet', paletSearch.trim())
      if (loteSearch.trim()) params.append('lote', loteSearch.trim())

      const res = await fetch(`/api/caducados?${params.toString()}`)
      if (!res.ok) throw new Error('Error fetching data')
      const json = await res.json()

      setData(json.data || [])
      setSummary(json.summary || { totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })

      if (json.locations?.length > 0) setLocations(json.locations)
      if (json.lotStates?.length > 0) setAvailableLotStates(json.lotStates)
    } catch (err) {
      console.error('Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setSelectedPlants([])
    setSelectedLocations([])
    setSelectedType('todos')
    setSelectedLotStates([])
    setSelectedSrp1([])
    setSelectedSrp2([])
    setPaletSearch('')
    setLoteSearch('')
    setSelectedArticles([])
    setAppliedArticles([])
    setData([])
    setSummary({ totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })
  }

  // --- PRESETS (serialización de filtros para PresetPanel) ---

  const { presets, reload: reloadPresets } = usePresets('caducados')

  // Objeto de filtros que se guarda como preset (mismo formato que antes)
  const getPresetFilters = () => ({
    type: selectedType,
    selectedLotStates,
    selectedSrp1,
    selectedSrp2,
    selectedPlants,
    selectedLocations,
    paletSearch,
    loteSearch,
    selectedArticles,
  })

  // Aplica los filtros de un preset cargado (mismo comportamiento que el antiguo loadPreset)
  const applyPresetFilters = (f: Record<string, unknown>) => {
    setSelectedType((f.type as 'todos' | 'caducados' | 'obsoletos' | 'bloqueados') || 'todos')
    setSelectedLotStates((f.selectedLotStates as string[]) || [])
    setSelectedSrp1((f.selectedSrp1 as string[]) || [])
    setSelectedSrp2((f.selectedSrp2 as string[]) || [])
    setSelectedPlants((f.selectedPlants as string[]) || [])
    const locs = f.selectedLocations as string[] | undefined
    setSelectedLocations(locs && locs.length > 0 ? locs : ['__blank__'])
    setPaletSearch((f.paletSearch as string) || '')
    setLoteSearch((f.loteSearch as string) || '')
    setSelectedArticles((f.selectedArticles as string[]) || [])
  }

  const exportToExcel = () => {
    const excelRows = data.map(item => ({
      'Articulo': item.articleLong,
      'Descripcion': item.description,
      'Planta': item.plantName,
      'Ubicacion': item.location || '(General)',
      'Palet_Lote': item.paletLote,
      'Palet': item.palet,
      'Lote': item.lote,
      'Cantidad': item.quantity,
      'Fecha Caducidad': item.expiryDate || '',
      'Motivo': item.motivo,
    }))

    const ws = XLSX.utils.json_to_sheet(excelRows)
    ws['!cols'] = [
      { wch: 18 }, { wch: 30 }, { wch: 15 }, { wch: 14 }, { wch: 20 },
      { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 14 }, { wch: 22 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Caducados_Obsoletos")
    XLSX.writeFile(wb, `Caducados_Obsoletos_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const typeButtons: { value: 'todos' | 'caducados' | 'obsoletos' | 'bloqueados'; label: string }[] = [
    { value: 'todos', label: 'Todos' },
    { value: 'caducados', label: 'Caducados' },
    { value: 'obsoletos', label: 'Obsoletos' },
    { value: 'bloqueados', label: 'Bloqueados' },
  ]

  return (
    <AppShell
      navbar={{
        currentPanel: "caducados",
        user: sessionUser,
        onLogout: logout,
        onPresetsClick: () => setPresetsSignal(s => s + 1),
      }}
      title="Palets caducados"
      description="Palets caducados, obsoletos y bloqueados por planta y ubicación"
    >

      {/* --- PANEL DE PRESETS --- */}
      {sessionUser && (
        <PresetPanel
          screen="caducados"
          presets={presets}
          onReload={reloadPresets}
          open={showPresets}
          onClose={() => setShowPresets(false)}
          getFilters={getPresetFilters}
          applyFilters={applyPresetFilters}
          hint="Se guardarán el tipo, bloqueos, categorías, planta, ubicación y búsquedas seleccionados."
        />
      )}

      {/* --- FILTROS --- */}
      <Card accent className="space-y-4 p-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Filtros</p>
          <div className="flex flex-wrap items-end gap-3">

            {/* Tipo */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Tipo</label>
              <div className="flex rounded-md overflow-hidden border border-input">
                {typeButtons.map(btn => (
                  <button
                    type="button"
                    key={btn.value}
                    onClick={() => setSelectedType(btn.value)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${selectedType === btn.value ? 'bg-primary text-primary-foreground' : 'bg-card text-secondary-foreground hover:bg-muted/50'}`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de bloqueo */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Tipo de bloqueo</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableLotStates.map(s => ({ id: s.code, description: s.description }))}
                  selected={selectedLotStates}
                  onChange={setSelectedLotStates}
                  label="Tipo bloqueo"
                  showId={true}
                />
              </div>
            </div>

            {/* Categoría */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Categoría</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp1} selected={selectedSrp1} onChange={setSelectedSrp1} label="Categoría" />
              </div>
            </div>

            {/* Familia */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Familia</label>
              <div className="w-[170px]">
                <ArticleMultiSelect articles={availableSrp2} selected={selectedSrp2} onChange={setSelectedSrp2} label="Familia" />
              </div>
            </div>

            {/* Planta */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Planta</label>
              <div className="w-[180px]">
                <ArticleMultiSelect
                  articles={plants}
                  selected={selectedPlants}
                  onChange={setSelectedPlants}
                  label="Planta"
                  showId={true}
                />
              </div>
            </div>

            {/* Ubicacion */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-secondary-foreground">Ubicacion</label>
              <div className="w-[180px]">
                <ArticleMultiSelect
                  articles={[
                    { id: '__blank__', description: 'GENERICA' },
                    ...locations.filter(l => l !== '').map(l => ({ id: l, description: l })),
                  ]}
                  selected={selectedLocations}
                  onChange={setSelectedLocations}
                  label="Ubicacion"
                  showId={false}
                />
              </div>
            </div>

          </div>
        </div>

        {/* Búsqueda por Artículo / Palet / Lote */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Artículo — filtro cliente sobre los datos ya cargados */}
          <div className="grid gap-1.5">
            <label className="text-xs font-semibold text-secondary-foreground">
              Artículo
              {availableArticles.length > 0 && (
                <span className="ml-1 text-muted-foreground font-normal">({availableArticles.length})</span>
              )}
            </label>
            <div className="w-[220px]">
              <ArticleMultiSelect
                articles={availableArticles}
                selected={selectedArticles}
                onChange={setSelectedArticles}
                label="Artículo"
                showId={true}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="cad-palet" className="text-xs font-semibold text-secondary-foreground">Palet</label>
            <input
              id="cad-palet"
              type="text"
              value={paletSearch}
              onChange={e => setPaletSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('cad-filtrar')?.click()}
              placeholder="ej: *98789 ó 757585*"
              className="flex h-9 w-[200px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-ring font-medium placeholder:font-normal placeholder:text-muted-foreground"
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="cad-lote" className="text-xs font-semibold text-secondary-foreground">Lote</label>
            <input
              id="cad-lote"
              type="text"
              value={loteSearch}
              onChange={e => setLoteSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && document.getElementById('cad-filtrar')?.click()}
              placeholder="ej: *98789 ó 757585*"
              className="flex h-9 w-[200px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-ring font-medium placeholder:font-normal placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Acciones */}
        <div className="flex flex-wrap items-end gap-3 justify-end">
          <Button id="cad-filtrar" onClick={() => fetchData()} disabled={loading} className="font-semibold">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}
            Filtrar
          </Button>
          <Button onClick={exportToExcel} variant="outline" disabled={data.length === 0} className="border-success text-success hover:bg-success/10 hover:text-success">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            Excel
          </Button>
          <Button onClick={clearFilters} variant="outline" className="text-muted-foreground">
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Limpiar
          </Button>

          {/* Presets (solo si logueado) */}
          {sessionUser && (
            <>
              <PresetQuickSelect presets={presets} onSelect={(p) => applyPresetFilters(JSON.parse(p.filters))} />
              <Button variant="outline" className="border-info text-info hover:bg-info/10 hover:text-info" onClick={() => setShowPresets(true)}>
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                Guardar
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* --- TARJETAS METRICAS --- */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <KpiCard
          title="Total Palets"
          icon={Package}
          value={displaySummary.totalPallets.toLocaleString('es-ES')}
          caption="Registros encontrados"
        />

        <KpiCard title="Caducados" icon={AlertTriangle}>
          <div className="text-2xl font-black text-destructive">{displaySummary.caducados.toLocaleString('es-ES')}</div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Palets con fecha vencida</p>
        </KpiCard>

        <KpiCard title="Obsoletos" icon={AlertTriangle}>
          <div className="text-2xl font-black text-warning">{displaySummary.obsoletos.toLocaleString('es-ES')}</div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Palets con articulo obsoleto</p>
        </KpiCard>

        <KpiCard title="Bloqueados" icon={Lock}>
          <div className="text-2xl font-black text-info">{displaySummary.bloqueados.toLocaleString('es-ES')}</div>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Palets con estado de lote activo</p>
        </KpiCard>
      </div>

      {/* --- TABLA DE DATOS --- */}
      <Card accent>
        <CardHeader>
          <CardTitle className="text-lg font-bold text-foreground">Palets Caducados y Obsoletos</CardTitle>
        </CardHeader>
        <CardContent>
          <CaducadosTable data={deferredData} loading={loading} />
        </CardContent>
      </Card>

    </AppShell>
  )
}
