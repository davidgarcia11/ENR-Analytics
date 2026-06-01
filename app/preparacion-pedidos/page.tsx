"use client"

import { useState, useEffect, useMemo, useDeferredValue } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Search, Loader2, Download, X,
  ChevronDown, ChevronRight, Package, CheckCircle2, Clock, AlertCircle,
  Save, BookmarkCheck, Trash2, Pencil, Calendar,
} from "lucide-react"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { DatePicker } from "@/components/DatePicker"
import Navbar from "@/components/Navbar"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"
import React from "react"

// Coincidencia con comodín: * funciona como % en SQL (ej: *123, 123*, *123*)
// Sin comodín → búsqueda de subcadena (comportamiento por defecto)
function matchesWildcard(value: string, pattern: string): boolean {
  if (!pattern) return true
  if (!pattern.includes('*')) return value.toLowerCase().includes(pattern.toLowerCase())
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i').test(value)
}

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

interface LotDetail {
  lineNumber: number
  qtyOrdered: number
  lot: string
  assigned: boolean
}

interface ArticleGroup {
  itemNumber: string
  description: string
  familia: string
  totalOrdered: number
  totalAssigned: number
  totalPending: number
  uom: string
  progress: number
  lots: LotDetail[]
}

interface Order {
  orderNumber: number
  customerRef: string
  loadDate: string
  deliveryDate: string
  plant: string
  plantName: string
  shipToNum: number | null
  shipToDesc: string
  shipToMlnm: string
  soldToNum: number | null
  soldToDesc: string
  articles: ArticleGroup[]
  totalArticles: number
  overallProgress: number
  status: 'completado' | 'en_progreso' | 'pendiente'
}

interface Summary {
  totalOrders: number
  completados: number
  enProgreso: number
  pendientes: number
}

type Preset = { id: number; name: string; filters: string; created_at: string }

export default function PreparacionPedidos() {
  const router = useRouter()

  // Auth
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)

  // Data
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)

  // Plantas disponibles
  const [plants, setPlants] = useState<{ id: string; description: string }[]>([])

  // Fecha de hoy
  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  // --- FILTROS SERVIDOR ---
  const [selectedPlants, setSelectedPlants] = useState<string[]>([])
  const [filters, setFilters] = useState({
    startDate: todayStr, endDate: todayStr,
    deliveryStartDate: '', deliveryEndDate: '',
  })
  const [dateError, setDateError] = useState('')

  // --- FILTROS CLIENTE (se aplican al pulsar "Filtrar") ---
  const [showStatus, setShowStatus] = useState({ pendiente: true, en_progreso: true, completado: true })
  const [selectedArticles, setSelectedArticles]   = useState<string[]>([])
  const [appliedArticles, setAppliedArticles]     = useState<string[]>([])
  const [selectedDestinos, setSelectedDestinos]   = useState<string[]>([])
  const [appliedDestinos, setAppliedDestinos]     = useState<string[]>([])
  const [pedidoSearch, setPedidoSearch]                         = useState('')
  const [appliedPedidoSearch, setAppliedPedidoSearch]           = useState('')
  const [refClienteSearch, setRefClienteSearch]                 = useState('')
  const [appliedRefClienteSearch, setAppliedRefClienteSearch]   = useState('')
  const [selectedDestinoMlnm, setSelectedDestinoMlnm]   = useState<string[]>([])
  const [appliedDestinoMlnm, setAppliedDestinoMlnm]     = useState<string[]>([])
  const [selectedFamilia, setSelectedFamilia]             = useState<string[]>([])
  const [appliedFamilia, setAppliedFamilia]               = useState<string[]>([])
  const [allFamilias, setAllFamilias]                     = useState<{ id: string; description: string }[]>([])

  // --- EXPAND / COLLAPSE ---
  const [expandedOrders, setExpandedOrders]     = useState<Set<number>>(new Set())
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set())

  // --- PRESETS ---
  const [presets, setPresets]               = useState<Preset[]>([])
  const [showPresets, setShowPresets]       = useState(false)
  const [presetName, setPresetName]         = useState('')
  const [savingPreset, setSavingPreset]     = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<number | null>(null)

  // --- DERIVADOS (memos) ---

  const availableArticles = useMemo(() => {
    const map = new Map<string, { id: string; description: string }>()
    orders.forEach(order =>
      order.articles.forEach(a => {
        if (a.itemNumber) map.set(a.itemNumber, { id: a.itemNumber, description: a.description })
      })
    )
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id))
  }, [orders])

  const availableDestinos = useMemo(() => {
    const map = new Map<string, { id: string; description: string }>()
    orders.forEach(order => {
      if (order.shipToNum) {
        const key = String(order.shipToNum)
        map.set(key, { id: key, description: order.shipToDesc || key })
      }
    })
    return Array.from(map.values()).sort((a, b) => a.description.localeCompare(b.description))
  }, [orders])

  const availableDestinoMlnm = useMemo(() => {
    const map = new Map<string, { id: string; description: string }>()
    orders.forEach(order => {
      if (order.shipToMlnm) map.set(order.shipToMlnm, { id: order.shipToMlnm, description: order.shipToMlnm })
    })
    return Array.from(map.values()).sort((a, b) => a.description.localeCompare(b.description))
  }, [orders])

  const availableFamilia = allFamilias

  const filteredOrders = useMemo(() => {
    const anyStatusActive = Object.values(showStatus).some(Boolean)
    return orders.filter(order => {
      if (anyStatusActive && !showStatus[order.status]) return false
      if (appliedArticles.length > 0 && !order.articles.some(a => appliedArticles.includes(a.itemNumber))) return false
      if (appliedDestinos.length > 0 && !appliedDestinos.includes(String(order.shipToNum ?? ''))) return false
      if (appliedPedidoSearch && !matchesWildcard(String(order.orderNumber), appliedPedidoSearch.trim())) return false
      if (appliedRefClienteSearch && !matchesWildcard(order.customerRef, appliedRefClienteSearch.trim())) return false
      if (appliedDestinoMlnm.length > 0 && !appliedDestinoMlnm.includes(order.shipToMlnm)) return false
      if (appliedFamilia.length > 0 && !order.articles.some(a => appliedFamilia.includes(a.familia))) return false
      return true
    })
  }, [orders, showStatus, appliedArticles, appliedDestinos, appliedPedidoSearch, appliedRefClienteSearch, appliedDestinoMlnm, appliedFamilia])

  const displaySummary = useMemo<Summary>(() => ({
    totalOrders: filteredOrders.length,
    completados: filteredOrders.filter(o => o.status === 'completado').length,
    enProgreso:  filteredOrders.filter(o => o.status === 'en_progreso').length,
    pendientes:  filteredOrders.filter(o => o.status === 'pendiente').length,
  }), [filteredOrders])

  const deferredOrders = useDeferredValue(filteredOrders)

  // --- INIT ---
  useEffect(() => {
    checkSession()
    fetchPlants()
    fetchData()
    fetch('/api/categories?field=srp2').then(r => r.ok ? r.json() : []).then(setAllFamilias).catch(() => {})
  }, [])

  useEffect(() => {
    if (sessionUser) loadPresets()
    else setPresets([])
  }, [sessionUser])

  // --- DATOS ---

  const fetchPlants = async () => {
    try {
      const res = await fetch('/api/plants')
      if (res.ok) setPlants(await res.json())
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
        const mine = screens['pedidos']
        if (mine && !mine.is_public) {
          if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
            router.push('/login'); return
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
    // Aplicar filtros cliente al lanzar la búsqueda
    setAppliedArticles(selectedArticles)
    setAppliedDestinos(selectedDestinos)
    setAppliedPedidoSearch(pedidoSearch)
    setAppliedRefClienteSearch(refClienteSearch)
    setAppliedDestinoMlnm(selectedDestinoMlnm)
    setAppliedFamilia(selectedFamilia)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      selectedPlants.forEach(v => params.append('plant', v))
      if (filters.startDate)        params.append('startDate',        filters.startDate)
      if (filters.endDate)          params.append('endDate',          filters.endDate)
      if (filters.deliveryStartDate) params.append('deliveryStartDate', filters.deliveryStartDate)
      if (filters.deliveryEndDate)   params.append('deliveryEndDate',   filters.deliveryEndDate)

      const res  = await fetch(`/api/orders?${params.toString()}`)
      const json = await res.json()

      if (json.error) {
        console.error('API error:', json.error)
        setOrders([])
        return
      }

      const statusOrder: Record<string, number> = { pendiente: 0, en_progreso: 1, completado: 2 }
      setOrders((json.orders || []).sort((a: Order, b: Order) => statusOrder[a.status] - statusOrder[b.status]))
    } catch (error) {
      console.error('Error cargando pedidos', error)
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setSelectedPlants([])
    setFilters({ startDate: todayStr, endDate: todayStr, deliveryStartDate: '', deliveryEndDate: '' })
    setShowStatus({ pendiente: true, en_progreso: true, completado: true })
    setSelectedArticles([]);  setAppliedArticles([])
    setSelectedDestinos([]);  setAppliedDestinos([])
    setPedidoSearch('');                    setAppliedPedidoSearch('')
    setRefClienteSearch('');              setAppliedRefClienteSearch('')
    setSelectedDestinoMlnm([]);           setAppliedDestinoMlnm([])
    setSelectedFamilia([]);               setAppliedFamilia([])
    setDateError('')
    setExpandedOrders(new Set())
    setExpandedArticles(new Set())
    setOrders([])
    setEditingPresetId(null)
    setPresetName('')
  }

  const applyFilters = () => {
    const cargaOk = !!(filters.startDate && filters.endDate)
    const entregaOk = !!(filters.deliveryStartDate && filters.deliveryEndDate)
    if (!cargaOk && !entregaOk) {
      setDateError('Debes rellenar al menos un rango de fechas (Carga o Entrega).')
      return
    }
    setDateError('')
    setExpandedOrders(new Set())
    setExpandedArticles(new Set())
    fetchData()
  }

  // --- EXPAND ---

  const toggleExpand  = (orderNumber: number) => setExpandedOrders(prev => { const n = new Set(prev); n.has(orderNumber) ? n.delete(orderNumber) : n.add(orderNumber); return n })
  const toggleArticle = (orderNumber: number, itemNumber: string) => {
    const key = `${orderNumber}-${itemNumber}`
    setExpandedArticles(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // --- PRESETS ---

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/presets?screen=pedidos')
      if (res.ok) setPresets(await res.json())
    } catch { }
  }

  const savePreset = async (nameOverride?: string) => {
    const name = nameOverride || presetName
    if (!name.trim()) return
    setSavingPreset(true)
    try {
      const filtersData = {
        selectedPlants,
        startDate: filters.startDate, endDate: filters.endDate,
        deliveryStartDate: filters.deliveryStartDate, deliveryEndDate: filters.deliveryEndDate,
        showStatus,
        selectedArticles, selectedDestinos,
        pedidoSearch, refClienteSearch, selectedDestinoMlnm, selectedFamilia,
      }
      const isEditing = editingPresetId !== null
      const res = await fetch(isEditing ? `/api/presets/${editingPresetId}` : '/api/presets', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters: filtersData, screen: 'pedidos' }),
      })
      if (res.ok) { setPresetName(''); setEditingPresetId(null); loadPresets() }
      else { const d = await res.json(); alert(d.error || 'Error al guardar') }
    } finally { setSavingPreset(false) }
  }

  const loadPreset = (preset: Preset) => {
    const f = JSON.parse(preset.filters)
    setSelectedPlants(f.selectedPlants || [])
    setFilters({
      startDate:        f.startDate        || todayStr,
      endDate:          f.endDate          || todayStr,
      deliveryStartDate: f.deliveryStartDate || '',
      deliveryEndDate:   f.deliveryEndDate   || '',
    })
    setShowStatus(f.showStatus || { pendiente: true, en_progreso: true, completado: true })
    setSelectedArticles(f.selectedArticles || [])
    setSelectedDestinos(f.selectedDestinos || [])
    setPedidoSearch(f.pedidoSearch             || '')
    setRefClienteSearch(f.refClienteSearch     || '')
    setSelectedDestinoMlnm(f.selectedDestinoMlnm || [])
    setSelectedFamilia(f.selectedFamilia         || [])
    setShowPresets(false)
  }

  const startEditPreset = (preset: Preset) => {
    setPresetName(preset.name); setEditingPresetId(preset.id)
    loadPreset(preset); setShowPresets(true)
  }

  const cancelEditPreset = () => { setEditingPresetId(null); setPresetName('') }

  const deletePreset = async (id: number) => {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    loadPresets()
  }

  // --- EXCEL ---

  const exportToExcel = () => {
    const rows = deferredOrders.flatMap(order =>
      order.articles.flatMap(article =>
        article.lots.map(lot => ({
          'Pedido':           order.orderNumber,
          'Ref. Cliente':     order.customerRef || '',
          'Nº Destino':       order.shipToNum   || '',
          'Desc. Destino':    order.shipToDesc   || '',
          'Cliente':          order.shipToMlnm   || '',
          'Nº Comprador':     order.soldToNum    || '',
          'Desc. Comprador':  order.soldToDesc   || '',
          'Fecha Carga':      order.loadDate     ? new Date(order.loadDate).toLocaleDateString('es-ES')    : '',
          'Fecha Entrega':    order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('es-ES') : '',
          'Planta':           order.plantName,
          'Articulo':         article.itemNumber,
          'Descripcion':      article.description,
          'Linea':            lot.lineNumber,
          'Cant. Pedida':     lot.qtyOrdered,
          'Lote/Palet':       lot.lot || '—',
          'Asignado':         lot.assigned ? 'SÍ' : 'NO',
          'Total Pedido Art.':   article.totalOrdered,
          'Total Asignado Art.': article.totalAssigned,
          'Total Pendiente Art.':article.totalPending,
          '% Progreso Art.':  article.progress / 100,
          'UM':               article.uom,
          'Estado':           order.status === 'completado' ? 'COMPLETADO' : order.status === 'en_progreso' ? 'EN PROGRESO' : 'PENDIENTE',
        }))
      )
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 18 })]
      if (cell) cell.z = '0.00%'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Preparacion Pedidos')
    XLSX.writeFile(wb, `Preparacion_Pedidos_${filters.startDate}_${filters.endDate}.xlsx`)
  }

  // --- RENDER ---

  const statusButtons = [
    { value: 'pendiente'   as const, label: 'Pendientes'  },
    { value: 'en_progreso' as const, label: 'En Progreso' },
    { value: 'completado'  as const, label: 'Completados' },
  ]

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- BARRA DE NAVEGACIÓN --- */}
        <Navbar currentPanel="pedidos" user={sessionUser} onLogout={logout} />

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
                <p className="text-[11px] text-gray-400 mt-1.5">Se guardarán las plantas, fechas, estado, artículo, destino y búsquedas seleccionados.</p>
              )}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Presets guardados</p>
            {presets.length === 0 ? (
              <p className="text-xs text-gray-400">No tienes presets guardados.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <div key={p.id} className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm ${editingPresetId === p.id ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}>
                    <button type="button" onClick={() => loadPreset(p)} className="font-medium text-gray-700 hover:text-gray-900" title="Cargar preset">
                      {p.name}
                    </button>
                    <button type="button" onClick={() => startEditPreset(p)} className="text-gray-300 hover:text-blue-500" aria-label={`Editar ${p.name}`}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => deletePreset(p.id)} className="text-gray-300 hover:text-red-500" aria-label={`Eliminar ${p.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* --- TÍTULO --- */}
        <div>
          <h1 className="text-2xl font-black text-gray-900">Preparación de Pedidos</h1>
          <p className="text-sm text-gray-500 mt-1">Progreso de asignación de palets a pedidos de venta</p>
        </div>

        {/* --- FILTROS --- */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4" style={{ borderTop: '3px solid #D30B15' }}>

          {/* Sección 1: Filtros principales */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Filtros</p>
            <div className="flex flex-wrap items-end gap-3">

              {/* Estado */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Estado</label>
                <div className="flex rounded-md overflow-hidden border border-gray-300">
                  {statusButtons.map((btn, i) => (
                    <button
                      key={btn.value}
                      type="button"
                      onClick={() => setShowStatus(prev => ({ ...prev, [btn.value]: !prev[btn.value] }))}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${i < statusButtons.length - 1 ? 'border-r border-gray-300' : ''} ${showStatus[btn.value] ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      style={showStatus[btn.value] ? { backgroundColor: '#D30B15' } : {}}
                    >
                      {btn.label}
                    </button>
                  ))}
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

              {/* Artículo */}
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

              {/* Destino */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">
                  Destino
                  {availableDestinos.length > 0 && (
                    <span className="ml-1 text-slate-400 font-normal">({availableDestinos.length})</span>
                  )}
                </label>
                <div className="w-[220px]">
                  <ArticleMultiSelect
                    articles={availableDestinos}
                    selected={selectedDestinos}
                    onChange={setSelectedDestinos}
                    label="Destino"
                    showId={true}
                  />
                </div>
              </div>

            </div>
          </div>

          {/* Sección 2: Búsqueda libre */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="ped-pedido" className="text-xs font-semibold text-gray-700">Nº Pedido</label>
              <input
                id="ped-pedido"
                type="text"
                value={pedidoSearch}
                onChange={e => setPedidoSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && document.getElementById('ped-filtrar')?.click()}
                placeholder="ej: *12345 ó 12345*"
                className="flex h-9 w-[200px] rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-slate-500 font-medium placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="ped-ref" className="text-xs font-semibold text-gray-700">Ref. Cliente</label>
              <input
                id="ped-ref"
                type="text"
                value={refClienteSearch}
                onChange={e => setRefClienteSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && document.getElementById('ped-filtrar')?.click()}
                placeholder="ej: *REF ó REF*"
                className="flex h-9 w-[200px] rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:border-slate-500 font-medium placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Sección 2b: Filtros desplegables adicionales */}
          <div className="flex flex-wrap items-end gap-3">

            {/* Cliente (F0111.WWMLNM) */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">
                Cliente
                {availableDestinoMlnm.length > 0 && (
                  <span className="ml-1 text-slate-400 font-normal">({availableDestinoMlnm.length})</span>
                )}
              </label>
              <div className="w-[220px]">
                <ArticleMultiSelect
                  articles={availableDestinoMlnm}
                  selected={selectedDestinoMlnm}
                  onChange={setSelectedDestinoMlnm}
                  label="Cliente"
                  showId={false}
                />
              </div>
            </div>

            {/* Familia */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">
                Familia
                {availableFamilia.length > 0 && (
                  <span className="ml-1 text-slate-400 font-normal">({availableFamilia.length})</span>
                )}
              </label>
              <div className="w-[220px]">
                <ArticleMultiSelect
                  articles={availableFamilia}
                  selected={selectedFamilia}
                  onChange={setSelectedFamilia}
                  label="Familia"
                  showId={true}
                />
              </div>
            </div>

          </div>

          {/* Sección 3: Fechas */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Fechas</p>
            <div className="flex flex-wrap items-end gap-4">

              {/* Fecha Carga */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Carga
                </label>
                <div className="flex items-center gap-1.5">
                  <DatePicker
                    value={filters.startDate}
                    onChange={v => setFilters({ ...filters, startDate: v })}
                    className="w-[140px]"
                  />
                  <span className="text-xs text-gray-400 font-medium select-none">→</span>
                  <DatePicker
                    value={filters.endDate}
                    onChange={v => setFilters({ ...filters, endDate: v })}
                    className="w-[140px]"
                  />
                </div>
              </div>

              {/* Fecha Entrega */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Entrega
                </label>
                <div className="flex items-center gap-1.5">
                  <DatePicker
                    value={filters.deliveryStartDate}
                    onChange={v => setFilters({ ...filters, deliveryStartDate: v })}
                    className="w-[140px]"
                  />
                  <span className="text-xs text-gray-400 font-medium select-none">→</span>
                  <DatePicker
                    value={filters.deliveryEndDate}
                    onChange={v => setFilters({ ...filters, deliveryEndDate: v })}
                    className="w-[140px]"
                  />
                </div>
              </div>

            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-3 justify-end">
            {dateError && (
              <p className="text-xs text-red-600 font-medium flex-1 text-right">{dateError}</p>
            )}
            <Button
              id="ped-filtrar"
              onClick={applyFilters}
              disabled={loading}
              className="text-white font-semibold"
              style={{ backgroundColor: '#D30B15' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#b00a12')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#D30B15')}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Filtrar
            </Button>
            <Button
              onClick={exportToExcel}
              variant="outline"
              disabled={deferredOrders.length === 0}
              className="border-green-600 text-green-700 hover:bg-green-50"
            >
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

        {/* --- TARJETAS KPI --- */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Total Pedidos</CardTitle>
              <Package className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{displaySummary.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Pedidos en el rango</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Completados</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-green-600">{displaySummary.completados}</div>
              <p className="text-xs text-gray-500 font-medium">100% asignado</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">En Progreso</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-amber-600">{displaySummary.enProgreso}</div>
              <p className="text-xs text-gray-500 font-medium">Parcialmente asignado</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Pendientes</CardTitle>
              <AlertCircle className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-400">{displaySummary.pendientes}</div>
              <p className="text-xs text-gray-500 font-medium">Sin asignar</p>
            </CardContent>
          </Card>
        </div>

        {/* --- TABLA DE PEDIDOS --- */}
        <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-800">Pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 hover:bg-transparent">
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="font-bold text-gray-700">
                    <div className="leading-tight">
                      <div>Nº Pedido</div>
                      <div className="text-[11px] font-normal text-gray-400">Ref. Cliente</div>
                    </div>
                  </TableHead>
                  <TableHead className="font-bold text-gray-700">
                    <div className="leading-tight">
                      <div>Destino</div>
                      <div className="text-[11px] font-normal text-gray-400">Cliente</div>
                    </div>
                  </TableHead>
                  <TableHead className="font-bold text-gray-700">Fecha Carga</TableHead>
                  <TableHead className="font-bold text-gray-700">Fecha Entrega</TableHead>
                  <TableHead className="font-bold text-gray-700">Planta</TableHead>
                  <TableHead className="font-bold text-gray-700">Arts.</TableHead>
                  <TableHead className="font-bold text-gray-700 w-[200px]">Progreso</TableHead>
                  <TableHead className="font-bold text-gray-700">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deferredOrders.map(order => (
                  <React.Fragment key={order.orderNumber}>
                    {/* Fila resumen del pedido */}
                    <TableRow
                      className="hover:bg-slate-50 border-gray-100 cursor-pointer"
                      onClick={() => toggleExpand(order.orderNumber)}
                    >
                      <TableCell className="w-8 px-2">
                        {expandedOrders.has(order.orderNumber)
                          ? <ChevronDown className="h-4 w-4 text-gray-400" />
                          : <ChevronRight className="h-4 w-4 text-gray-400" />}
                      </TableCell>
                      <TableCell className="font-bold text-gray-900">
                        <div className="leading-tight">
                          <div>{order.orderNumber}</div>
                          {order.customerRef && (
                            <div className="text-[11px] font-normal text-gray-400 font-mono">{order.customerRef}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-bold text-gray-900">
                        <div className="leading-tight">
                          <div>{order.shipToDesc || '—'}</div>
                          {order.shipToMlnm && (
                            <div className="text-[11px] font-normal text-gray-400 font-mono">{order.shipToMlnm}</div>
                          )}
                          {order.shipToNum && (
                            <div className="text-[11px] font-normal text-gray-400 font-mono">{order.shipToNum}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">
                        {order.loadDate ? new Date(order.loadDate).toLocaleDateString('es-ES') : ''}
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">
                        {order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('es-ES') : ''}
                      </TableCell>
                      <TableCell className="text-gray-700">{order.plantName}</TableCell>
                      <TableCell className="text-gray-600">{order.totalArticles}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                order.overallProgress >= 100 ? 'bg-green-500'
                                : order.overallProgress > 0  ? 'bg-amber-500'
                                : 'bg-gray-300'
                              }`}
                              style={{ width: `${Math.min(order.overallProgress, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-gray-600 w-[40px] text-right">
                            {order.overallProgress.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {order.status === 'completado' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
                            <CheckCircle2 className="h-3 w-3" /> COMPLETADO
                          </span>
                        )}
                        {order.status === 'en_progreso' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                            <Clock className="h-3 w-3" /> EN PROGRESO
                          </span>
                        )}
                        {order.status === 'pendiente' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
                            <AlertCircle className="h-3 w-3" /> PENDIENTE
                          </span>
                        )}
                      </TableCell>
                    </TableRow>

                    {/* Detalle expandido — Nivel 1: Artículos agrupados */}
                    {expandedOrders.has(order.orderNumber) && (
                      <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                        <TableCell colSpan={9} className="p-0">
                          <div className="px-4 py-4">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                                  <th className="w-6"></th>
                                  <th className="text-left py-2 px-2">Artículo</th>
                                  <th className="text-left py-2 px-2">Descripción</th>
                                  <th className="text-right py-2 px-2">Total Pedido</th>
                                  <th className="text-right py-2 px-2">Total Asignado</th>
                                  <th className="text-right py-2 px-2">Total Pendiente</th>
                                  <th className="py-2 px-2 w-[150px]">Progreso</th>
                                  <th className="text-center py-2 px-2">UM</th>
                                </tr>
                              </thead>
                              <tbody>
                                {order.articles.map((article) => {
                                  const articleKey = `${order.orderNumber}-${article.itemNumber}`
                                  const isArticleExpanded = expandedArticles.has(articleKey)
                                  return (
                                    <React.Fragment key={article.itemNumber}>
                                      {/* Fila artículo agrupado */}
                                      <tr
                                        className="border-b border-gray-200 cursor-pointer hover:bg-gray-100/60"
                                        onClick={() => toggleArticle(order.orderNumber, article.itemNumber)}
                                      >
                                        <td className="py-2 px-1">
                                          {isArticleExpanded
                                            ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                            : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                                        </td>
                                        <td className="py-2 px-2 font-mono text-xs text-gray-700 font-bold">{article.itemNumber}</td>
                                        <td className="py-2 px-2 text-gray-600 uppercase text-xs font-semibold">{article.description}</td>
                                        <td className="py-2 px-2 text-right font-bold">{article.totalOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                                        <td className="py-2 px-2 text-right font-semibold text-green-700">{article.totalAssigned.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                                        <td className="py-2 px-2 text-right text-amber-600">{article.totalPending.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                                        <td className="py-2 px-2">
                                          <div className="flex items-center gap-1.5">
                                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                              <div
                                                className={`h-full rounded-full ${
                                                  article.progress >= 100 ? 'bg-green-500'
                                                  : article.progress > 0  ? 'bg-blue-500'
                                                  : 'bg-gray-300'
                                                }`}
                                                style={{ width: `${Math.min(article.progress, 100)}%` }}
                                              />
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-500 w-[32px] text-right">
                                              {article.progress.toFixed(0)}%
                                            </span>
                                          </div>
                                        </td>
                                        <td className="py-2 px-2 text-center text-xs text-gray-500 font-mono">{article.uom}</td>
                                      </tr>

                                      {/* Nivel 2: Lotes/líneas individuales */}
                                      {isArticleExpanded && article.lots.map((lot, lotIdx) => (
                                        <tr key={lotIdx} className={`border-b border-gray-50 ${lot.assigned ? 'bg-green-50/50' : 'bg-amber-50/30'}`}>
                                          <td></td>
                                          <td className="py-1.5 px-2 pl-5">
                                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-gray-600">
                                              <span className="text-gray-300">↳</span>
                                              {lot.lot || <span className="italic text-gray-400">Sin lote</span>}
                                            </span>
                                          </td>
                                          <td className="py-1.5 px-2">
                                            {lot.assigned
                                              ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">✓ ASIGNADO</span>
                                              : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">⏳ PENDIENTE</span>
                                            }
                                          </td>
                                          <td className="py-1.5 px-2 text-right text-[11px] text-gray-600 font-medium">{lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                                          <td className={`py-1.5 px-2 text-right text-[11px] ${lot.assigned ? 'text-green-600 font-semibold' : 'text-gray-300'}`}>
                                            {lot.assigned ? lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                                          </td>
                                          <td className={`py-1.5 px-2 text-right text-[11px] ${!lot.assigned ? 'text-amber-600 font-semibold' : 'text-gray-300'}`}>
                                            {!lot.assigned ? lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                                          </td>
                                          <td></td>
                                          <td></td>
                                        </tr>
                                      ))}
                                    </React.Fragment>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}

                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {!loading && deferredOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-gray-500 font-medium">
                      No se encontraron pedidos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
