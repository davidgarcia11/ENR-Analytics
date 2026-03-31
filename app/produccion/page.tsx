"use client" // Indica que este componente se ejecuta en el navegador del usuario (cliente), no en el servidor

import { useState, useEffect, useMemo, useDeferredValue, memo } from "react" // Hooks de React para manejar estado y efectos secundarios
// Importamos componentes de interfaz de usuario (UI) reutilizables desde nuestra carpeta local
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
// Iconos de la librería lucide-react para dar estilo visual
import { Loader2, Factory, Calendar, ChevronDown, ChevronsDown, User, LogOut, Settings, FileText, BookmarkCheck } from "lucide-react"
import Image from "next/image"
import * as XLSX from 'xlsx'; // Librería 'xlsx' para generar archivos Excel
import { useRouter } from "next/navigation"
import { FilterPanel, AppliedFilters } from "@/components/FilterPanel"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

// Tabla de producción extraída como componente memoizado para evitar re-renders
// cuando el usuario edita filtros sin haber pulsado "Filtrar" todavía.
// React.memo compara las props por referencia: como displayData solo cambia cuando
// cambia deferredData (no al editar filtros), la tabla no se re-renderiza al escribir.
const ProductionTable = memo(({ displayData, mermaP75, groupByArticle, loading, dataLength, hasMore, onLoadMore, onLoadAll }: {
  displayData: any[]; mermaP75: number; groupByArticle: boolean;
  loading: boolean; dataLength: number; hasMore: boolean;
  onLoadMore: () => void; onLoadAll: () => void;
}) => {
  const getMermaColor = (percent: number) => {
    if (percent === 0) return 'text-gray-400';
    if (percent >= mermaP75 && mermaP75 > 0) return 'text-red-600 bg-red-50 font-black';
    if (percent >= 5) return 'text-red-500 font-bold';
    if (percent >= 2) return 'text-amber-600 font-bold';
    return 'text-green-600 font-semibold';
  };
  return (
    <Card className="col-span-4 border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-gray-800">Detalle de Producción</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="border-gray-200 hover:bg-transparent">
              <TableHead className="font-bold text-gray-700">Fecha</TableHead>
              <TableHead className="font-bold text-gray-700">Artículo</TableHead>
              <TableHead className="font-bold text-gray-700">Descripción</TableHead>
              <TableHead className="text-right font-bold text-gray-700">Fabricado</TableHead>
              <TableHead className="text-right font-bold text-gray-700">Merma</TableHead>
              <TableHead className="text-right font-bold text-gray-700">Fabricado + Merma</TableHead>
              <TableHead className="text-right font-bold text-gray-700">% Merma</TableHead>
              <TableHead className="font-bold text-gray-700 text-center">UM</TableHead>
              <TableHead className="font-bold text-gray-700">Planta / Línea</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayData.map((row, i) => (
              <TableRow key={i} className="hover:bg-slate-50 border-gray-100">
                <TableCell className="font-medium text-gray-900">
                  {groupByArticle ? <span className="text-gray-400 text-xs">Varios</span> : (row.date ? new Date(row.date).toLocaleDateString() : row.productionDateRaw)}
                </TableCell>
                <TableCell className="text-gray-700 font-mono text-xs bg-gray-100 px-2 py-1 rounded w-fit">{row.article}</TableCell>
                <TableCell className="text-gray-600 uppercase text-xs font-semibold">{row.description}</TableCell>
                <TableCell className="text-right font-bold text-slate-900">
                  {row.quantity?.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right text-sm text-gray-700">
                  {Math.abs(row.merma || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right text-sm font-semibold text-gray-800">
                  {(Math.round(row.quantity || 0) + Math.round(Math.abs(row.merma || 0))).toLocaleString('es-ES')}
                </TableCell>
                <TableCell className={`text-right text-sm px-3 py-1 rounded ${getMermaColor(row.mermaPercent || 0)}`}>
                  {(row.mermaPercent || 0).toFixed(2)}%
                </TableCell>
                <TableCell className="text-center text-xs text-gray-500 font-mono">{row.unit}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-800 text-xs">{row.subLine}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{row.subLineCode} · {row.plantCode}</span>
                  </div>
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
            {!loading && dataLength === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10 text-gray-500 font-medium">
                  No se encontraron datos para los filtros seleccionados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {hasMore && dataLength > 0 && !loading && (
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={onLoadMore} variant="ghost" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100">
              <ChevronDown className="mr-2 h-4 w-4" />
              Cargar más (150)
            </Button>
            <Button onClick={onLoadAll} variant="outline" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-300">
              <ChevronsDown className="mr-2 h-4 w-4" />
              Cargar todos
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
ProductionTable.displayName = 'ProductionTable';

// Genera los filtros por defecto con la fecha de hoy
function makeTodayFilters(): AppliedFilters {
  const d = new Date()
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    plant: 'all', subLine: 'all',
    startDate: todayStr, endDate: todayStr,
    startTime: '', endTime: '',
    selectedArticles: [], selectedPrp6: [], selectedSrp3: [], selectedSrp5: [],
    selectedSrp2: [], selectedSrp1: [], selectedSrp4: [], selectedZe03: [],
    selectedProdLines: [],
  }
}

// Función principal del componente Dashboard
export default function Dashboard() {
  const router = useRouter()

  // --- AUTENTICACIÓN ---
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  // Señal para abrir el panel de presets desde el botón del header (se incrementa)
  const [presetsSignal, setPresetsSignal] = useState(0)

  // --- DATOS ---
  const [data, setData] = useState<any[]>([]) // Lista de registros de producción
  const [loading, setLoading] = useState(false) // Spinner de carga
  const [page, setPage] = useState(1) // Página actual para paginación
  const [hasMore, setHasMore] = useState(true) // Si hay más datos por cargar

  // Artículos disponibles para el filtro (se pueblan tras cada búsqueda)
  const [availableArticles, setAvailableArticles] = useState<{ id: string; description: string }[]>([])

  // groupByArticle vive en Dashboard porque afecta a displayData
  const [groupByArticle, setGroupByArticle] = useState(false)

  // Últimos filtros aplicados — se usan en loadMore/loadAll para continuar la misma búsqueda
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>(makeTodayFilters)

  // --- MÉTRICAS ---
  const [metrics, setMetrics] = useState({
    totalQtyUN: 0,
    totalQtyKG: 0,
    totalOrders: 0,
    byPlant: {} as Record<string, number>,
    totalMerma: 0,
    totalProduced: 0,
  })

  // --- CARGA INICIAL ---
  useEffect(() => {
    const initial = makeTodayFilters()
    setAppliedFilters(initial)
    fetchData(1, true, false, initial)
    checkSession()
  }, [])

  // --- AUTENTICACIÓN ---

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const user = await res.json()
        if (user.mustChangePassword) {
          router.push('/cambiar-contrasena')
          return
        }
        setSessionUser(user)
      }
    } catch { /* no logueado, ok */ }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
  }

  // --- FETCH DE DATOS ---

  // Función asíncrona principal para pedir datos al servidor (API)
  const fetchData = async (pageNum: number, isNewSearch: boolean, allRecords = false, filtersArg: AppliedFilters) => {
    setLoading(true)
    try {
      // Construimos los parámetros de la URL
      const params = new URLSearchParams()
      if (filtersArg.plant !== 'all') params.append('plant', filtersArg.plant)
      if (filtersArg.subLine !== 'all') params.append('subLine', filtersArg.subLine)
      if (filtersArg.startDate) params.append('startDate', filtersArg.startDate)
      if (filtersArg.endDate) params.append('endDate', filtersArg.endDate)
      if (filtersArg.startTime && filtersArg.startTime !== '00:00' && filtersArg.startTime !== '00:00:00') params.append('startTime', filtersArg.startTime)
      if (filtersArg.endTime && filtersArg.endTime !== '00:00' && filtersArg.endTime !== '00:00:00') params.append('endTime', filtersArg.endTime)
      filtersArg.selectedArticles.forEach(a => params.append('article', a))
      filtersArg.selectedPrp6.forEach(v => params.append('prp6', v))
      filtersArg.selectedSrp3.forEach(v => params.append('srp3', v))
      filtersArg.selectedSrp5.forEach(v => params.append('srp5', v))
      filtersArg.selectedSrp2.forEach(v => params.append('srp2', v))
      filtersArg.selectedSrp1.forEach(v => params.append('srp1', v))
      filtersArg.selectedSrp4.forEach(v => params.append('srp4', v))
      filtersArg.selectedZe03.forEach(v => params.append('ze03', v))
      filtersArg.selectedProdLines.forEach(v => params.append('prodLine', v))

      params.append('page', pageNum.toString())
      params.append('limit', allRecords ? '0' : '150')

      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json()

      // La API devuelve { data: [...], sqlRowCount: N }
      const items = json.data ?? json
      const sqlRowCount = json.sqlRowCount ?? (Array.isArray(json) ? json.length : items.length)

      if (Array.isArray(items)) {
        // Usamos sqlRowCount (filas SQL antes de procesar) para determinar si hay más páginas
        if (allRecords || sqlRowCount < 150) setHasMore(false)
        else setHasMore(true)

        const newData = isNewSearch ? items : [...data, ...items]
        setData(newData)

        // Extraer artículos únicos de los datos para el multi-select
        const articleMap = new Map<string, { id: string; description: string }>()
        if (isNewSearch) {
          newData.forEach((item: any) => {
            if (item.article && item.description)
              articleMap.set(String(item.article).trim(), { id: String(item.article).trim(), description: item.description })
          })
          setAvailableArticles(Array.from(articleMap.values()))
        } else {
          setAvailableArticles(prev => {
            prev.forEach(a => articleMap.set(a.id, a))
            newData.slice(-items.length).forEach((item: any) => {
              if (item.article && item.description)
                articleMap.set(String(item.article).trim(), { id: String(item.article).trim(), description: item.description })
            })
            return Array.from(articleMap.values())
          })
        }

        // --- CÁLCULO DE MÉTRICAS ---
        let qtyUN = 0, qtyKG = 0, totalMerma = 0, totalProduced = 0
        const plants: Record<string, number> = {}
        const orders = new Set()

        newData.forEach((item: any) => {
          const u = item.unit ? item.unit.toUpperCase() : ''
          if (u === 'UN') qtyUN += item.quantity || 0
          else if (u === 'KG') qtyKG += item.quantity || 0
          orders.add(item.order)
          const pName = item.subLine || 'Desconocido'
          plants[pName] = (plants[pName] || 0) + (item.quantity || 0)
          totalMerma += Math.abs(item.merma || 0)
          totalProduced += item.quantity || 0
        })

        setMetrics({ totalQtyUN: qtyUN, totalQtyKG: qtyKG, totalOrders: orders.size, byPlant: plants, totalMerma, totalProduced })
      }
    } catch (error) {
      console.error("Error cargando datos", error)
    } finally {
      setLoading(false)
    }
  }

  // --- HANDLERS ---

  // Llamado por FilterPanel cuando el usuario pulsa "Filtrar"
  // allRecords=true: carga todos los registros de golpe (sin paginación), igual que el comportamiento original
  const handleApply = (filters: AppliedFilters) => {
    setAppliedFilters(filters)
    setPage(1)
    setData([])
    fetchData(1, true, true, filters)
  }

  // Carga la siguiente página (usa los mismos filtros ya aplicados)
  const loadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchData(nextPage, false, false, appliedFilters)
  }

  // Carga todos los registros de golpe
  const loadAll = () => {
    setPage(1)
    setData([])
    fetchData(1, true, true, appliedFilters)
  }

  // Exporta los datos visibles a Excel
  const exportToExcel = () => {
    const sorted = [...displayData].sort((a, b) => (b.mermaPercent || 0) - (a.mermaPercent || 0))

    const excelRows = sorted.map(item => ({
      Fecha: item.date ? new Date(item.date).toLocaleDateString() : item.productionDateRaw,
      Articulo: item.article,
      Descripcion: item.description,
      Planta: item.subLine,
      Fabricado: Math.round(item.quantity || 0),
      Merma: Math.round(Math.abs(item.merma || 0)),
      'Fabricado + Merma': Math.round(item.quantity || 0) + Math.round(Math.abs(item.merma || 0)),
      '% Merma': (item.mermaPercent || 0) / 100,
      Unidad: item.unit
    }))

    const ws = XLSX.utils.json_to_sheet(excelRows)

    // Formato porcentaje en columna H (% Merma)
    const mermaColIdx = 7
    for (let r = 0; r < excelRows.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: mermaColIdx })
      if (ws[cellRef]) ws[cellRef].z = '0.00%'
    }

    // Colorear top 25% de % merma con fondo rojo
    const mermaValues = sorted.map(r => r.mermaPercent || 0).filter(v => v > 0)
    const p75Idx = Math.floor(mermaValues.length * 0.75)
    const p75Threshold = mermaValues.sort((a, b) => a - b)[p75Idx] || 0

    for (let r = 0; r < sorted.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: mermaColIdx })
      if (ws[cellRef] && (sorted[r].mermaPercent || 0) >= p75Threshold && p75Threshold > 0) {
        ws[cellRef].s = {
          fill: { fgColor: { rgb: 'FFCCCC' } },
          font: { bold: true, color: { rgb: 'CC0000' } }
        }
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Produccion")
    XLSX.writeFile(wb, `Produccion_${appliedFilters.startDate}_${appliedFilters.endDate}.xlsx`)
  }

  // --- AGRUPACIÓN Y DISPLAY ---

  // useDeferredValue permite que los inputs respondan inmediatamente aunque haya miles de filas.
  // React procesa primero los cambios de estado urgentes (escribir en un input) y deja
  // la re-renderización de la tabla para cuando el hilo principal esté libre.
  const deferredData = useDeferredValue(data)
  const deferredGroupByArticle = useDeferredValue(groupByArticle)

  const displayData = useMemo(() => {
    const groupMap = new Map<string, any>()
    deferredData.forEach(item => {
      const key = deferredGroupByArticle
        ? `${item.article}-${item.subLineCode}-${item.unit}`
        : `${item.article}-${item.productionDateRaw}-${item.subLineCode}-${item.unit}`
      if (!groupMap.has(key)) {
        groupMap.set(key, { ...item, quantity: 0, merma: 0 })
      }
      const g = groupMap.get(key)
      g.quantity += item.quantity || 0
      g.merma += item.merma || 0
    })
    return Array.from(groupMap.values()).map(item => {
      const absMerma = Math.abs(item.merma)
      const total = absMerma + item.quantity
      const mermaPercent = total > 0
        ? Math.round((absMerma / total) * 10000) / 100
        : 0
      return { ...item, mermaPercent }
    }).sort((a, b) => b.mermaPercent - a.mermaPercent)
  }, [deferredData, deferredGroupByArticle])

  // Calcula el umbral del percentil 75 de % merma para formato condicional
  const mermaP75 = useMemo(() => {
    const values = displayData.map(r => r.mermaPercent).filter(v => v > 0).sort((a, b) => a - b)
    if (values.length === 0) return 0
    const idx = Math.floor(values.length * 0.75)
    return values[Math.min(idx, values.length - 1)]
  }, [displayData])

  // --- RENDERIZADO ---
  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- BARRA DE SESIÓN --- */}
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
          <div className="flex-1" />
          <button onClick={() => router.push('/caducados')} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300">
            Caducados
          </button>
          {sessionUser ? (
            <>
              <span className="text-sm text-gray-600 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {sessionUser.name ? `${sessionUser.name} ${sessionUser.surname || ''}`.trim() : sessionUser.username}
              </span>
              {sessionUser.role === 'admin' && (
                <>
                  <button onClick={() => router.push('/admin')} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <Settings className="h-3.5 w-3.5" />
                    Admin
                  </button>
                  <button onClick={() => router.push('/admin/logs')} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    Logs
                  </button>
                </>
              )}
              {/* El botón Presets incrementa presetsSignal, que FilterPanel usa para abrir su panel */}
              <button onClick={() => setPresetsSignal(s => s + 1)} className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 flex items-center gap-1.5">
                <BookmarkCheck className="h-3.5 w-3.5" />
                Presets
              </button>
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            </>
          ) : (
            <a href="/login" className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300">
              <User className="h-3.5 w-3.5" />
              Iniciar sesión
            </a>
          )}
        </div>

        {/* --- PANEL DE FILTROS ---
            FilterPanel gestiona internamente su draft state (filtros, presets, categorías).
            Solo notifica al Dashboard cuando el usuario pulsa "Filtrar" (via onApply).
            Esto evita re-renders del Dashboard (tabla + métricas) al editar los filtros. */}
        <FilterPanel
          sessionUser={sessionUser}
          availableArticles={availableArticles}
          loading={loading}
          dataLength={data.length}
          groupByArticle={groupByArticle}
          onApply={handleApply}
          onExcel={exportToExcel}
          onGroupByArticleChange={setGroupByArticle}
          openPresetsSignal={presetsSignal}
        />

        {/* --- TARJETAS DE MÉTRICAS (KPIs) --- */}
        <div className="grid gap-4 md:grid-cols-4">
          {/* Tarjeta 1: Cantidad Total */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Cantidad Total</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="flex flex-col space-y-1">
                <div className="flex items-baseline justify-between">
                  <div className="text-2xl font-black text-gray-900">{metrics.totalQtyUN.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</div>
                  <span className="text-xs font-bold text-gray-500">UN</span>
                </div>
                {metrics.totalQtyKG > 0 && (
                  <div className="flex items-baseline justify-between border-t border-gray-100 pt-1">
                    <div className="text-lg font-bold text-gray-700">{metrics.totalQtyKG.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</div>
                    <span className="text-xs font-bold text-gray-500">KG</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 font-medium mt-2">Unidades fabricadas (cargadas)</p>
            </CardContent>
          </Card>

          {/* Tarjeta 2: Órdenes */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Órdenes</CardTitle>
              <Calendar className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{metrics.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Total de órdenes (cargadas)</p>
            </CardContent>
          </Card>

          {/* Tarjeta 3: Merma global */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Merma</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              {(() => {
                const total = metrics.totalMerma + metrics.totalProduced
                const pct = total > 0 ? (metrics.totalMerma / total) * 100 : 0
                const color = pct >= 5 ? 'text-red-600' : pct >= 2 ? 'text-amber-600' : 'text-green-600'
                return (
                  <div className="flex flex-col space-y-1">
                    <div className="flex items-baseline justify-between">
                      <div className={`text-2xl font-black ${color}`}>{pct.toFixed(2)}%</div>
                    </div>
                    <div className="text-xs text-gray-500 font-medium">
                      {metrics.totalMerma.toLocaleString('es-ES', { maximumFractionDigits: 0 })} merma / {metrics.totalProduced.toLocaleString('es-ES', { maximumFractionDigits: 0 })} producido
                    </div>
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          {/* Tarjeta 4: Planta con mayor volumen */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Top Planta</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">
                {Object.entries(metrics.byPlant).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
              </div>
              <p className="text-xs text-gray-500 font-medium">Mayor volumen (cargado)</p>
            </CardContent>
          </Card>
        </div>

        {/* --- TABLA DE DATOS --- */}
        <ProductionTable
          displayData={displayData}
          mermaP75={mermaP75}
          groupByArticle={groupByArticle}
          loading={loading}
          dataLength={data.length}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onLoadAll={loadAll}
        />

      </div>
    </div>
  )
}
