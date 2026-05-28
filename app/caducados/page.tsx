"use client"

import { useState, useEffect, useDeferredValue, useMemo, memo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search, Loader2, Download, X, AlertTriangle, Package, MapPin, Lock, Save, BookmarkCheck, Trash2, Pencil } from "lucide-react"
import Navbar from "@/components/Navbar"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { Input } from "@/components/ui/input"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
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

function getMotivoBadge(motivo: string) {
  if (motivo.includes('Caducado') && motivo.includes('+')) return 'bg-red-100 text-red-800 border border-red-300 font-bold'
  if (motivo === 'Caducado') return 'bg-red-50 text-red-700 border border-red-200 font-semibold'
  if (motivo === 'Obsoleto') return 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold'
  if (motivo.includes('+')) return 'bg-purple-50 text-purple-700 border border-purple-200 font-bold'
  if (motivo !== 'Desconocido') return 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
  return 'bg-gray-50 text-gray-700 border border-gray-200 font-semibold'
}

const CaducadosTable = memo(function CaducadosTable({ data, loading }: { data: PaletRow[]; loading: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-gray-200 hover:bg-transparent">
          <TableHead className="font-bold text-gray-700">Articulo</TableHead>
          <TableHead className="font-bold text-gray-700">Descripcion</TableHead>
          <TableHead className="font-bold text-gray-700">Planta</TableHead>
          <TableHead className="font-bold text-gray-700">Ubicacion</TableHead>
          <TableHead className="font-bold text-gray-700">Palet</TableHead>
          <TableHead className="font-bold text-gray-700">Lote</TableHead>
          <TableHead className="text-right font-bold text-gray-700">Cantidad</TableHead>
          <TableHead className="font-bold text-gray-700">Fecha Cad.</TableHead>
          <TableHead className="font-bold text-gray-700 text-center whitespace-nowrap">Motivo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, i) => (
          <TableRow key={i} className="hover:bg-slate-50 border-gray-100">
            <TableCell className="text-gray-700 font-mono text-xs bg-gray-100 px-2 py-1 rounded w-fit">{row.articleLong}</TableCell>
            <TableCell className="text-gray-600 uppercase text-xs font-semibold">{row.description}</TableCell>
            <TableCell className="text-gray-700 text-sm">{row.plantName}</TableCell>
            <TableCell className="text-gray-600 text-xs">
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-gray-400" />
                {row.location || 'GENERICA'}
              </span>
            </TableCell>
            <TableCell className="text-gray-600 font-mono text-xs">{row.palet}</TableCell>
            <TableCell className="text-gray-600 font-mono text-xs">{row.lote}</TableCell>
            <TableCell className="text-right font-bold text-slate-900">
              {row.quantity.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
            </TableCell>
            <TableCell className="text-gray-700 text-sm">
              {row.expiryDate ? new Date(row.expiryDate).toLocaleDateString('es-ES') : '-'}
            </TableCell>
            <TableCell className="text-center whitespace-nowrap">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${getMotivoBadge(row.motivo)}`}>
                {row.motivo}
              </span>
            </TableCell>
          </TableRow>
        ))}

        {loading && (
          <TableRow>
            <TableCell colSpan={9} className="text-center py-10">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
            </TableCell>
          </TableRow>
        )}

        {!loading && data.length === 0 && (
          <TableRow>
            <TableCell colSpan={9} className="text-center py-10 text-gray-500 font-medium">
              Pulsa &quot;Filtrar&quot; para buscar palets caducados u obsoletos.
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
  const [presets, setPresets] = useState<{ id: number; name: string; filters: string; created_at: string }[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [savingPreset, setSavingPreset] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<number | null>(null)
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

  useEffect(() => {
    checkSession()
    fetchLotStates()
    fetchCategories()
    fetchPlants()
    fetchData()
  }, [])

  useEffect(() => {
    if (sessionUser) loadPresets()
    else setPresets([])
  }, [sessionUser])

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

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      let user = null
      if (res.ok) {
        user = await res.json()
        if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return }
        setSessionUser(user)
      }
      const screensRes = await fetch('/api/screen-permissions')
      if (screensRes.ok) {
        const screens = await screensRes.json()
        const mine = screens['caducados']
        if (mine && !mine.is_public) {
          if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
            router.push('/login')
            return
          }
        }
      }
    } catch { }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
  }

  const fetchData = async () => {
    // Aplicar el filtro de artículo al pulsar "Filtrar" (igual que producción)
    setAppliedArticles(selectedArticles)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      selectedPlants.forEach(v => params.append('plant', v))
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
    setEditingPresetId(null)
    setPresetName('')
    setData([])
    setSummary({ totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })
  }

  // --- FUNCIONES DE PRESETS ---

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/presets?screen=caducados')
      if (res.ok) setPresets(await res.json())
    } catch { }
  }

  const savePreset = async (nameOverride?: string) => {
    const name = nameOverride || presetName
    if (!name.trim()) return
    setSavingPreset(true)
    try {
      const filtersData = {
        type: selectedType,
        selectedLotStates,
        selectedSrp1,
        selectedSrp2,
        selectedPlants,
        selectedLocations,
        paletSearch,
        loteSearch,
        selectedArticles,
      }
      const isEditing = editingPresetId !== null
      const res = await fetch(isEditing ? `/api/presets/${editingPresetId}` : '/api/presets', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters: filtersData, screen: 'caducados' }),
      })
      if (res.ok) {
        setPresetName('')
        setEditingPresetId(null)
        loadPresets()
      } else {
        const data = await res.json()
        alert(data.error || 'Error al guardar')
      }
    } finally { setSavingPreset(false) }
  }

  const loadPreset = (preset: { id: number; name: string; filters: string; created_at: string }) => {
    const f = JSON.parse(preset.filters)
    setSelectedType(f.type || 'todos')
    setSelectedLotStates(f.selectedLotStates || [])
    setSelectedSrp1(f.selectedSrp1 || [])
    setSelectedSrp2(f.selectedSrp2 || [])
    setSelectedPlants(f.selectedPlants || [])
    setSelectedLocations(f.selectedLocations?.length > 0 ? f.selectedLocations : ['__blank__'])
    setPaletSearch(f.paletSearch || '')
    setLoteSearch(f.loteSearch || '')
    setSelectedArticles(f.selectedArticles || [])
    setShowPresets(false)
  }

  const startEditPreset = (preset: { id: number; name: string; filters: string; created_at: string }) => {
    setPresetName(preset.name)
    setEditingPresetId(preset.id)
    loadPreset(preset)
    setShowPresets(true)
  }

  const cancelEditPreset = () => {
    setEditingPresetId(null)
    setPresetName('')
  }

  const deletePreset = async (id: number) => {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    loadPresets()
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
    <main className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        <Navbar currentPanel="caducados" user={sessionUser} onLogout={logout} />

        {/* --- PANEL DE PRESETS --- */}
        {sessionUser && showPresets && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" style={{ borderTop: '3px solid #D30B15' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <BookmarkCheck className="h-4 w-4" style={{ color: '#D30B15' }} />
                Mis Presets de Filtros
              </h3>
              <button type="button" aria-label="Cerrar presets" onClick={() => { setShowPresets(false); cancelEditPreset() }} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Guardar filtros actuales */}
            <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {editingPresetId ? 'Editando preset' : 'Guardar filtros actuales como preset'}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="Escribe un nombre..."
                  className="h-9 text-sm max-w-[220px] bg-white"
                  onKeyDown={e => e.key === 'Enter' && savePreset()}
                />
                <Button
                  onClick={() => savePreset()}
                  disabled={savingPreset || !presetName.trim()}
                  size="sm"
                  className="text-white text-xs font-semibold h-9 px-4"
                  style={{ backgroundColor: editingPresetId ? '#2563eb' : '#D30B15' }}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {editingPresetId ? 'Actualizar' : 'Guardar'}
                </Button>
                {editingPresetId && (
                  <Button onClick={cancelEditPreset} variant="outline" size="sm" className="text-xs h-9 text-gray-500">
                    Cancelar
                  </Button>
                )}
              </div>
              {!editingPresetId && (
                <p className="text-[11px] text-gray-400 mt-1.5">Se guardarán el tipo, bloqueos, categorías, planta, ubicación y búsquedas seleccionados.</p>
              )}
            </div>

            {/* Presets guardados */}
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Presets guardados</p>
            {presets.length === 0 ? (
              <p className="text-xs text-gray-400">No tienes presets guardados.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <div key={p.id} className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm ${editingPresetId === p.id ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}>
                    <button type="button" onClick={() => loadPreset(p)} className="font-medium text-gray-700 hover:text-gray-900" title="Cargar preset" aria-label={`Cargar preset ${p.name}`}>
                      {p.name}
                    </button>
                    <button type="button" onClick={() => startEditPreset(p)} className="text-gray-300 hover:text-blue-500" aria-label={`Editar preset ${p.name}`}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => deletePreset(p.id)} className="text-gray-300 hover:text-red-500" aria-label={`Eliminar preset ${p.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- FILTROS --- */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4" style={{ borderTop: '3px solid #D30B15' }}>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Filtros</p>
            <div className="flex flex-wrap items-end gap-3">

              {/* Tipo */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Tipo</label>
                <div className="flex rounded-md overflow-hidden border border-gray-300">
                  {typeButtons.map(btn => (
                    <button
                      type="button"
                      key={btn.value}
                      onClick={() => setSelectedType(btn.value)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${selectedType === btn.value ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      style={selectedType === btn.value ? { backgroundColor: '#D30B15' } : {}}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tipo de bloqueo */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Tipo de bloqueo</label>
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
                <label className="text-xs font-semibold text-gray-700">Categoría</label>
                <div className="w-[170px]">
                  <ArticleMultiSelect articles={availableSrp1} selected={selectedSrp1} onChange={setSelectedSrp1} label="Categoría" />
                </div>
              </div>

              {/* Familia */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Familia</label>
                <div className="w-[170px]">
                  <ArticleMultiSelect articles={availableSrp2} selected={selectedSrp2} onChange={setSelectedSrp2} label="Familia" />
                </div>
              </div>

              {/* Planta */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Planta</label>
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
                <label className="text-xs font-semibold text-gray-700">Ubicacion</label>
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
              <label className="text-xs font-semibold text-gray-700">
                Artículo
                {availableArticles.length > 0 && (
                  <span className="ml-1 text-slate-400 font-normal">({availableArticles.length})</span>
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
              <label htmlFor="cad-palet" className="text-xs font-semibold text-gray-700">Palet</label>
              <input
                id="cad-palet"
                type="text"
                value={paletSearch}
                onChange={e => setPaletSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && document.getElementById('cad-filtrar')?.click()}
                placeholder="ej: *98789 ó 757585*"
                className="flex h-9 w-[200px] rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-slate-500 font-medium placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="cad-lote" className="text-xs font-semibold text-gray-700">Lote</label>
              <input
                id="cad-lote"
                type="text"
                value={loteSearch}
                onChange={e => setLoteSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && document.getElementById('cad-filtrar')?.click()}
                placeholder="ej: *98789 ó 757585*"
                className="flex h-9 w-[200px] rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-slate-500 font-medium placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Acciones */}
          <div className="flex flex-wrap items-end gap-3 justify-end">
            <Button id="cad-filtrar" onClick={fetchData} disabled={loading} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#b00a12')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#D30B15')}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Filtrar
            </Button>
            <Button onClick={exportToExcel} variant="outline" disabled={data.length === 0} className="border-green-600 text-green-700 hover:bg-green-50">
              <Download className="mr-2 h-4 w-4" />
              Excel
            </Button>
            <Button onClick={clearFilters} variant="outline" className="border-gray-400 text-gray-600 hover:bg-gray-50">
              <X className="mr-2 h-4 w-4" />
              Limpiar
            </Button>

            {/* Presets (solo si logueado) */}
            {sessionUser && (
              <>
                {presets.length > 0 && (
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-gray-700">Cargar preset</label>
                    <select
                      onChange={e => { const p = presets.find(p => p.id === Number(e.target.value)); if (p) loadPreset(p); e.target.value = '' }}
                      defaultValue=""
                      className="flex h-9 w-[160px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm"
                    >
                      <option value="" disabled>Seleccionar...</option>
                      {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                )}
                <Button variant="outline" className="border-blue-500 text-blue-600 hover:bg-blue-50" onClick={() => setShowPresets(true)}>
                  <Save className="mr-2 h-4 w-4" />
                  Guardar
                </Button>
              </>
            )}
          </div>
        </div>

        {/* --- TARJETAS METRICAS --- */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Total Palets</CardTitle>
              <Package className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{displaySummary.totalPallets.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Registros encontrados</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Caducados</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-red-600">{displaySummary.caducados.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets con fecha vencida</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Obsoletos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-amber-600">{displaySummary.obsoletos.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets con articulo obsoleto</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Bloqueados</CardTitle>
              <Lock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-blue-600">{displaySummary.bloqueados.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets con estado de lote activo</p>
            </CardContent>
          </Card>
        </div>

        {/* --- TABLA DE DATOS --- */}
        <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-800">Palets Caducados y Obsoletos</CardTitle>
          </CardHeader>
          <CardContent>
            <CaducadosTable data={deferredData} loading={loading} />
          </CardContent>
        </Card>

      </div>
    </main>
  )
}
