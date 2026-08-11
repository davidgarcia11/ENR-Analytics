"use client" // Indica que este componente se ejecuta en el navegador del usuario (cliente), no en el servidor

import { useState, useEffect, useMemo, useDeferredValue, memo, useCallback } from "react" // Hooks de React para manejar estado y efectos secundarios
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
import { Factory, Calendar, ChevronDown, ChevronsDown, ChevronRight, SearchX } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { KpiCard } from "@/components/KpiCard"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import * as XLSX from 'xlsx'; // Librería 'xlsx' para generar archivos Excel
import { useRouter } from "next/navigation"
import { FilterPanel, AppliedFilters } from "@/components/FilterPanel"
import MermaBreakdown, { MermaCode } from "@/components/MermaBreakdown"
import MermaCellPopover from "@/components/MermaCellPopover"

// Construye los URLSearchParams para los endpoints de producción a partir de los filtros aplicados.
// Se reutiliza en /api/production y /api/production/merma-breakdown.
function buildProductionParams(filtersArg: AppliedFilters): URLSearchParams {
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
  return params
}

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

// Fila de producción tal como la devuelve GET /api/production (fecha ya serializada a ISO string)
interface ProductionRow {
  order: string
  date: string | null
  productionDateRaw: number | string
  description: string
  quantity: number
  merma: number
  plantCode: string
  article: string
  subLine: string
  subLineCode?: string
  unit: string
}

// Fila agregada (agrupada por artículo+fecha o solo por artículo) con el % de merma ya calculado
interface DisplayRow extends ProductionRow {
  mermaPercent: number
}

// Fila del desglose de merma en modo "matrix" (GET /api/production/merma-breakdown?mode=matrix)
interface MermaMatrixItem {
  article: string; articleDesc: string
  group: string; code: string; description: string; qty: number
}

// Tabla de producción extraída como componente memoizado para evitar re-renders
// cuando el usuario edita filtros sin haber pulsado "Filtrar" todavía.
// React.memo compara las props por referencia: como displayData solo cambia cuando
// cambia deferredData (no al editar filtros), la tabla no se re-renderiza al escribir.
const ProductionTable = memo(({ displayData, mermaP75, groupByArticle, loading, dataLength, hasMore, onLoadMore, onLoadAll, appliedFilters }: {
  displayData: DisplayRow[]; mermaP75: number; groupByArticle: boolean;
  loading: boolean; dataLength: number; hasMore: boolean;
  onLoadMore: () => void; onLoadAll: () => void;
  appliedFilters: AppliedFilters;
}) => {
  const getMermaColor = (percent: number) => {
    if (percent === 0) return 'text-muted-foreground';
    if (percent >= mermaP75 && mermaP75 > 0) return 'text-red-600 bg-red-50 font-black';
    if (percent >= 5) return 'text-red-500 font-bold';
    if (percent >= 2) return 'text-amber-600 font-bold';
    return 'text-green-600 font-semibold';
  };
  return (
    <Card accent className="col-span-4 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-foreground">Detalle de Producción</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-bold text-secondary-foreground">Fecha</TableHead>
              <TableHead className="font-bold text-secondary-foreground">Artículo</TableHead>
              <TableHead className="font-bold text-secondary-foreground">Descripción</TableHead>
              <TableHead className="text-right font-bold text-secondary-foreground">Fabricado</TableHead>
              <TableHead className="text-right font-bold text-secondary-foreground">Merma</TableHead>
              <TableHead className="text-right font-bold text-secondary-foreground">Fabricado + Merma</TableHead>
              <TableHead className="text-right font-bold text-secondary-foreground">% Merma</TableHead>
              <TableHead className="font-bold text-secondary-foreground text-center">UM</TableHead>
              <TableHead className="font-bold text-secondary-foreground">Planta / Línea</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayData.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium text-foreground">
                  {groupByArticle ? <span className="text-muted-foreground text-xs">Varios</span> : (row.date ? new Date(row.date).toLocaleDateString() : row.productionDateRaw)}
                </TableCell>
                <TableCell className="text-secondary-foreground font-mono text-xs bg-muted px-2 py-1 rounded w-fit">{row.article}</TableCell>
                <TableCell className="text-secondary-foreground uppercase text-xs font-semibold">{row.description}</TableCell>
                <TableCell className="text-right font-bold text-foreground">
                  {row.quantity?.toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right text-sm text-secondary-foreground">
                  {groupByArticle ? (
                    // En modo agrupado por artículo no se puede pedir el desglose por fila concreta
                    Math.abs(row.merma || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })
                  ) : (
                    <MermaCellPopover
                      rowMerma={row.merma || 0}
                      buildParams={() => buildProductionParams(appliedFilters)}
                      order={row.order}
                      productionDateRaw={row.productionDateRaw}
                      article={row.article}
                      cellContent={Math.abs(row.merma || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })}
                    />
                  )}
                </TableCell>
                <TableCell className="text-right text-sm font-semibold text-foreground">
                  {(Math.round(row.quantity || 0) + Math.round(Math.abs(row.merma || 0))).toLocaleString('es-ES')}
                </TableCell>
                <TableCell className={`text-right text-sm px-3 py-1 rounded ${getMermaColor(row.mermaPercent || 0)}`}>
                  {(row.mermaPercent || 0).toFixed(2)}%
                </TableCell>
                <TableCell className="text-center text-xs text-muted-foreground font-mono">{row.unit}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-foreground text-xs">{row.subLine}</span>
                    <span className="text-xs text-muted-foreground font-mono">{row.subLineCode} · {row.plantCode}</span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {loading && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9}>
                  <Spinner label="Cargando producción..." className="py-10" />
                </TableCell>
              </TableRow>
            )}
            {!loading && dataLength === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9}>
                  <EmptyState
                    icon={SearchX}
                    title="Sin resultados"
                    description="No se encontraron datos para los filtros seleccionados."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {hasMore && dataLength > 0 && !loading && (
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={onLoadMore} variant="ghost" className="text-secondary-foreground">
              <ChevronDown className="mr-2 h-4 w-4" aria-hidden="true" />
              Cargar más (150)
            </Button>
            <Button onClick={onLoadAll} variant="outline" className="text-secondary-foreground">
              <ChevronsDown className="mr-2 h-4 w-4" aria-hidden="true" />
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
  const [data, setData] = useState<ProductionRow[]>([]) // Lista de registros de producción
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

  // --- DESGLOSE DE MERMA (global) ---
  // Se rellena en cada Filtrar/Cargar todos en paralelo a fetchData
  const [globalBreakdown, setGlobalBreakdown] = useState<{ codes: MermaCode[]; total: number } | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownOpen, setBreakdownOpen] = useState(false) // Arranca colapsado, el usuario lo abre si le interesa

  // --- CARGA INICIAL ---
  useEffect(() => {
    const initial = makeTodayFilters()
    setAppliedFilters(initial)
    fetchData(1, true, false, initial)
    fetchGlobalBreakdown(initial)
    checkSession()
  }, [])

  // Pide el desglose global de merma para los filtros aplicados.
  // No bloquea la tabla principal; corre en paralelo.
  // Memoizado para que el toggle de la card no recree la función
  // y dispare re-renders en cascada.
  const fetchGlobalBreakdown = useCallback(async (filtersArg: AppliedFilters) => {
    setBreakdownLoading(true)
    try {
      const params = buildProductionParams(filtersArg)
      params.append('mode', 'global')
      const res = await fetch(`/api/production/merma-breakdown?${params.toString()}`)
      const json = await res.json()
      if (json && Array.isArray(json.codes)) {
        setGlobalBreakdown({ codes: json.codes, total: json.total || 0 })
      } else {
        setGlobalBreakdown({ codes: [], total: 0 })
      }
    } catch (err) {
      console.error('Error cargando desglose global:', err)
      setGlobalBreakdown(null)
    } finally {
      setBreakdownLoading(false)
    }
  }, [])

  // --- AUTENTICACIÓN ---

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      let user = null
      if (res.ok) {
        user = await res.json()
        if (user.mustChangePassword) {
          router.push('/cambiar-contrasena')
          return
        }
        setSessionUser(user)
      }
      const screensRes = await fetch('/api/screen-permissions')
      if (screensRes.ok) {
        const screens = await screensRes.json()
        const mine = screens['produccion']
        if (mine && !mine.is_public) {
          if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
            router.push('/login')
            return
          }
        }
      }
    } catch { /* no logueado, ok */ }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
  }

  // --- FETCH DE DATOS ---

  // Función asíncrona principal para pedir datos al servidor (API).
  // Memoizada SIN dependencia de `data`: usamos setData(prev => ...) para evitar
  // que la referencia cambie en cada actualización. Así loadMore/loadAll
  // (que dependen de fetchData) mantienen referencia estable y el React.memo
  // de ProductionTable funciona, evitando re-renders innecesarios de la tabla
  // grande cuando solo cambia algo ajeno (p. ej. toggle del desglose de merma).
  const fetchData = useCallback(async (pageNum: number, isNewSearch: boolean, allRecords = false, filtersArg: AppliedFilters) => {
    setLoading(true)
    try {
      // Construimos los parámetros de la URL
      const params = buildProductionParams(filtersArg)
      params.append('page', pageNum.toString())
      params.append('limit', allRecords ? '0' : '150')

      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json()

      // La API devuelve { data: [...], sqlRowCount: N }
      const items: ProductionRow[] = json.data ?? json
      const sqlRowCount = json.sqlRowCount ?? (Array.isArray(json) ? json.length : items.length)

      if (Array.isArray(items)) {
        // Usamos sqlRowCount (filas SQL antes de procesar) para determinar si hay más páginas
        if (allRecords || sqlRowCount < 150) setHasMore(false)
        else setHasMore(true)

        // Actualizamos data con functional update y, sobre el array resultante,
        // calculamos métricas y artículos disponibles (un único cómputo).
        setData(prev => {
          const newData = isNewSearch ? items : [...prev, ...items]

          // Artículos únicos para el multi-select
          const articleMap = new Map<string, { id: string; description: string }>()
          newData.forEach((item: ProductionRow) => {
            if (item.article && item.description)
              articleMap.set(String(item.article).trim(), { id: String(item.article).trim(), description: item.description })
          })
          setAvailableArticles(Array.from(articleMap.values()))

          // Métricas
          let qtyUN = 0, qtyKG = 0, totalMerma = 0, totalProduced = 0
          const plants: Record<string, number> = {}
          const orders = new Set()
          newData.forEach((item: ProductionRow) => {
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

          return newData
        })
      }
    } catch (error) {
      console.error("Error cargando datos", error)
    } finally {
      setLoading(false)
    }
  }, [])

  // --- HANDLERS ---

  // Llamado por FilterPanel cuando el usuario pulsa "Filtrar"
  // allRecords=true: carga todos los registros de golpe (sin paginación), igual que el comportamiento original
  const handleApply = useCallback((filters: AppliedFilters) => {
    setAppliedFilters(filters)
    setPage(1)
    setData([])
    fetchData(1, true, true, filters)
    fetchGlobalBreakdown(filters)
  }, [fetchData, fetchGlobalBreakdown])

  // Carga la siguiente página (usa los mismos filtros ya aplicados)
  const loadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchData(nextPage, false, false, appliedFilters)
  }, [page, appliedFilters, fetchData])

  // Carga todos los registros de golpe
  const loadAll = useCallback(() => {
    setPage(1)
    setData([])
    fetchData(1, true, true, appliedFilters)
    fetchGlobalBreakdown(appliedFilters)
  }, [appliedFilters, fetchData, fetchGlobalBreakdown])

  // Exporta los datos visibles a Excel (Producción + 2 hojas de desglose de merma)
  const exportToExcel = async () => {
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

    // --- Hoja "Merma por tipo" (desglose global agrupado Q/P) ---
    // Reutilizamos el globalBreakdown ya cargado; si no hay datos no añadimos la hoja.
    if (globalBreakdown && globalBreakdown.codes.length > 0) {
      const groupLabel = (g: string) => g === 'Q' ? 'Etiquetado' : g === 'P' ? 'Pasteurizado' : 'Otros'
      const ordered = [...globalBreakdown.codes].sort((a, b) => {
        if (a.group !== b.group) return a.group.localeCompare(b.group)
        return b.qty - a.qty
      })
      const tipoRows = ordered.map(c => ({
        Tipo: groupLabel(c.group),
        Codigo: c.code,
        Descripcion: c.description,
        Cantidad: Math.round(c.qty),
        '% sobre merma': (c.percent || 0) / 100,
      }))
      // Fila final con total global
      tipoRows.push({
        Tipo: '',
        Codigo: '',
        Descripcion: 'TOTAL',
        Cantidad: Math.round(globalBreakdown.total),
        '% sobre merma': 1,
      })
      const wsTipo = XLSX.utils.json_to_sheet(tipoRows)
      // Formato porcentaje en columna E (% sobre merma)
      for (let r = 0; r < tipoRows.length; r++) {
        const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: 4 })
        if (wsTipo[cellRef]) wsTipo[cellRef].z = '0.00%'
      }
      XLSX.utils.book_append_sheet(wb, wsTipo, "Merma por tipo")
    }

    // --- Hoja "Merma por artículo" (formato largo) ---
    // Fetch del modo matrix con los filtros vigentes. Si falla o no hay datos, se omite la hoja.
    try {
      const matrixParams = buildProductionParams(appliedFilters)
      matrixParams.append('mode', 'matrix')
      const res = await fetch(`/api/production/merma-breakdown?${matrixParams.toString()}`)
      const json = await res.json()
      const items: MermaMatrixItem[] = (json && Array.isArray(json.items)) ? json.items : []
      if (items.length > 0) {
        const groupLabel = (g: string) => g === 'Q' ? 'Etiquetado' : g === 'P' ? 'Pasteurizado' : 'Otros'
        const matrixRows = items.map(it => ({
          Articulo: it.article,
          'Descripción artículo': it.articleDesc,
          Tipo: groupLabel(it.group),
          Codigo: it.code,
          'Descripción código': it.description,
          Cantidad: Math.round(it.qty),
        }))
        const wsMatrix = XLSX.utils.json_to_sheet(matrixRows)
        XLSX.utils.book_append_sheet(wb, wsMatrix, "Merma por artículo")
      }
    } catch (err) {
      console.error('Error al cargar el desglose de merma por artículo para Excel:', err)
    }

    XLSX.writeFile(wb, `Produccion_${appliedFilters.startDate}_${appliedFilters.endDate}.xlsx`)
  }

  // --- AGRUPACIÓN Y DISPLAY ---

  // useDeferredValue permite que los inputs respondan inmediatamente aunque haya miles de filas.
  // React procesa primero los cambios de estado urgentes (escribir en un input) y deja
  // la re-renderización de la tabla para cuando el hilo principal esté libre.
  const deferredData = useDeferredValue(data)
  const deferredGroupByArticle = useDeferredValue(groupByArticle)

  const displayData = useMemo(() => {
    const groupMap = new Map<string, ProductionRow>()
    deferredData.forEach(item => {
      const key = deferredGroupByArticle
        ? `${item.article}-${item.subLineCode}-${item.unit}`
        : `${item.article}-${item.productionDateRaw}-${item.subLineCode}-${item.unit}`
      if (!groupMap.has(key)) {
        groupMap.set(key, { ...item, quantity: 0, merma: 0 })
      }
      const g = groupMap.get(key)!
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
    <AppShell
      navbar={{
        currentPanel: "produccion",
        user: sessionUser,
        onLogout: logout,
        onPresetsClick: () => setPresetsSignal(s => s + 1),
      }}
      title="Producción"
      description="Órdenes de fabricación, producción y merma por planta y línea"
    >
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
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {/* Tarjeta 1: Cantidad Total (cuerpo custom: dos filas UN/KG) */}
          <KpiCard title="Cantidad Total" icon={Factory}>
            <div className="flex flex-col space-y-1">
              <div className="flex items-baseline justify-between">
                <div className="text-2xl font-black text-foreground">{metrics.totalQtyUN.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</div>
                <span className="text-xs font-bold text-muted-foreground">UN</span>
              </div>
              {metrics.totalQtyKG > 0 && (
                <div className="flex items-baseline justify-between border-t border-border pt-1">
                  <div className="text-lg font-bold text-secondary-foreground">{metrics.totalQtyKG.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</div>
                  <span className="text-xs font-bold text-muted-foreground">KG</span>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-medium mt-2">Unidades fabricadas (cargadas)</p>
          </KpiCard>

          {/* Tarjeta 2: Órdenes */}
          <KpiCard title="Órdenes" icon={Calendar} value={metrics.totalOrders} caption="Total de órdenes (cargadas)" />

          {/* Tarjeta 3: Merma global (cuerpo custom: color condicional) */}
          <KpiCard title="Merma" icon={Factory}>
            {(() => {
              const total = metrics.totalMerma + metrics.totalProduced
              const pct = total > 0 ? (metrics.totalMerma / total) * 100 : 0
              const color = pct >= 5 ? 'text-red-600' : pct >= 2 ? 'text-amber-600' : 'text-green-600'
              return (
                <div className="flex flex-col space-y-1">
                  <div className={`text-2xl font-black ${color}`}>{pct.toFixed(2)}%</div>
                  <div className="text-xs text-muted-foreground font-medium">
                    {metrics.totalMerma.toLocaleString('es-ES', { maximumFractionDigits: 0 })} merma / {metrics.totalProduced.toLocaleString('es-ES', { maximumFractionDigits: 0 })} producido
                  </div>
                </div>
              )
            })()}
          </KpiCard>

          {/* Tarjeta 4: Planta con mayor volumen */}
          <KpiCard
            title="Top Planta"
            icon={Factory}
            value={Object.entries(metrics.byPlant).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
            caption="Mayor volumen (cargado)"
          />
        </div>

        {/* --- DESGLOSE DE MERMA (global) ---
            Arranca colapsada. El header completo es un botón que la abre/cierra. */}
        <Card accent className="shadow-sm">
          <button
            type="button"
            onClick={() => setBreakdownOpen(o => !o)}
            aria-expanded={breakdownOpen}
            aria-controls="desglose-merma-content"
            className="w-full text-left"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 hover:bg-muted/60 transition-colors">
              <div className="flex items-center gap-2">
                {breakdownOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
                <div>
                  <CardTitle className="text-lg font-bold text-foreground">Desglose de merma</CardTitle>
                  <p className="text-xs text-muted-foreground font-medium mt-1">
                    Por tipo de motivo (Q: Etiquetado · P: Pasteurizado). Pulsa para {breakdownOpen ? 'ocultar' : 'desplegar'}.
                  </p>
                </div>
              </div>
              {globalBreakdown && globalBreakdown.total > 0 && (
                <div className="text-right">
                  <div className="text-2xl font-black text-foreground">
                    {Math.round(globalBreakdown.total).toLocaleString('es-ES')}
                  </div>
                  <div className="text-xs text-muted-foreground">Total merma</div>
                </div>
              )}
            </CardHeader>
          </button>
          {breakdownOpen && (
            <CardContent id="desglose-merma-content">
              <MermaBreakdown
                codes={globalBreakdown?.codes || []}
                total={globalBreakdown?.total || 0}
                loading={breakdownLoading}
              />
            </CardContent>
          )}
        </Card>

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
          appliedFilters={appliedFilters}
        />

    </AppShell>
  )
}
