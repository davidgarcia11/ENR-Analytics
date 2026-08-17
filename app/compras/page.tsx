"use client"

import * as React from "react"
import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts"
import { AppShell } from "@/components/AppShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs } from "@/components/ui/tabs"
import { DatePicker } from "@/components/DatePicker"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { usePresets, PresetPanel, PresetQuickSelect } from "@/components/PresetPanel"
import { useToast } from "@/components/ui/toast"
import {
    ShoppingCart, Euro, Tag, Boxes, Scale, Package, ArrowUp, ArrowDown, AlertTriangle, Download,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

type Metrica = 'cantidad' | 'kg' | 'importe' | 'precio'
type PeriodPreset = 'mes_actual' | 'mes_anterior' | 'anio_actual' | 'ultimos_3m' | 'personalizado'

interface Row {
    item: string
    descripcion: string
    familia: string
    marca: string
    mesLabel: string
    gramaje: number | null
    previsto: { cantidad: number | null; precioUnitario: number | null; importe: number | null; kg: number | null }
    real: { cantidad: number | null; precioUnitario: number | null; importe: number | null; kg: number | null }
    desviacion: {
        cantidad: { abs: number | null; pct: number | null }
        kg: { abs: number | null; pct: number | null }
        importe: { abs: number | null; pct: number | null }
        precio: { abs: number | null; pct: number | null }
    }
    avisos: string[]
}

interface PorMes {
    mesLabel: string
    importePrevisto: number; importeReal: number
    cantidadPrevisto: number; cantidadReal: number
    kgPrevisto: number; kgReal: number
    precioPrevisto: number | null; precioReal: number | null
}

interface Resumen {
    totalCantidadPrevisto: number; totalCantidadReal: number; desviacionCantidadPct: number | null
    totalKgPrevisto: number; totalKgReal: number; desviacionKgPct: number | null
    totalImportePrevisto: number; totalImporteReal: number; desviacionImportePct: number | null
    precioMedioPrevisto: number | null; precioMedioReal: number | null; desviacionPrecioPct: number | null
    porMes: PorMes[]
    articulosSinGramaje: string[]
}

const RESUMEN_VACIO: Resumen = {
    totalCantidadPrevisto: 0, totalCantidadReal: 0, desviacionCantidadPct: null,
    totalKgPrevisto: 0, totalKgReal: 0, desviacionKgPct: null,
    totalImportePrevisto: 0, totalImporteReal: 0, desviacionImportePct: null,
    precioMedioPrevisto: null, precioMedioReal: null, desviacionPrecioPct: null,
    porMes: [],
    articulosSinGramaje: [],
}

const fmtEur = (v: number) => v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtPrecioUnitario = (v: number) => `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} €/ud`
const fmtCantidad = (v: number) => `${v.toLocaleString('es-ES', { maximumFractionDigits: 0 })} ud`
const fmtKg = (v: number) => `${v.toLocaleString('es-ES', { maximumFractionDigits: 0 })} kg`

// Formatos numéricos nativos de Excel (ponytail: 'xlsx' no soporta colores/negrita al escribir,
// solo number format + anchos de columna + merges — ver docs/compras.md).
const XLS_FMT_UD = '#,##0'
const XLS_FMT_KG = '#,##0" kg"'
const XLS_FMT_EUR = '#,##0.00" €"'
const XLS_FMT_PCT = '+0.00%;-0.00%'

// Aplica un number format de Excel a una columna completa (por índice, 0-based) de un rango de filas.
function setColNumFmt(ws: XLSX.WorkSheet, colIdx: number, rowCount: number, fmt: string, headerRows = 1) {
    for (let r = 0; r < rowCount; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r: r + headerRows, c: colIdx })]
        if (cell && typeof cell.v === 'number') cell.z = fmt
    }
}

function presetToRange(preset: PeriodPreset): { startDate: string; endDate: string } | null {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    // Formateo en fecha LOCAL (no toISOString(), que convierte a UTC y desplaza el día
    // hacia atrás en husos horarios con offset positivo, ej. Europe/Madrid).
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    switch (preset) {
        case 'mes_actual':
            return { startDate: fmt(new Date(y, m, 1)), endDate: fmt(new Date(y, m + 1, 0)) }
        case 'mes_anterior':
            return { startDate: fmt(new Date(y, m - 1, 1)), endDate: fmt(new Date(y, m, 0)) }
        case 'anio_actual':
            return { startDate: `${y}-01-01`, endDate: `${y}-12-31` }
        case 'ultimos_3m':
            return { startDate: fmt(new Date(y, m - 2, 1)), endDate: fmt(new Date(y, m + 1, 0)) }
        case 'personalizado':
            return null
    }
}

// Desplegable compacto de periodo, compartido en la cabecera de varias cards
// (mismo estado global, no rangos independientes por card).
function PeriodPresetSelect({ value, onChange }: { value: PeriodPreset; onChange: (p: PeriodPreset) => void }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as PeriodPreset)}
            aria-label="Periodo"
            className="h-7 rounded-md border border-input bg-card px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
            <option value="mes_actual">Este mes</option>
            <option value="mes_anterior">Mes anterior</option>
            <option value="anio_actual">Este año</option>
            <option value="ultimos_3m">Últimos 3 meses</option>
            <option value="personalizado">Personalizado…</option>
        </select>
    )
}

function DesviacionCard({
    titulo, icon: Icon, previsto, real, pct, formatValue, periodPreset, onPeriodChange, warning,
}: {
    titulo: string
    icon: LucideIcon
    previsto: number | null
    real: number | null
    pct: number | null
    formatValue: (v: number) => string
    periodPreset: PeriodPreset
    onPeriodChange: (p: PeriodPreset) => void
    /** Aviso opcional bajo el gauge (ej. "3 artículos sin gramaje"); al pulsar, despliega la lista. */
    warning?: { text: string; items: { item: string; descripcion: string }[] }
}) {
    // % cumplimiento (real/previsto) solo alimenta el gauge visual, capado a [0,150] — no implica juicio bueno/malo
    const pctCumplimiento = (previsto && previsto !== 0 && real != null)
        ? Math.max(0, Math.min(150, (real / previsto) * 100))
        : 0

    return (
        <Card accent>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-bold text-secondary-foreground">{titulo}</CardTitle>
                <PeriodPresetSelect value={periodPreset} onChange={onPeriodChange} />
            </CardHeader>
            <CardContent>
                <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center flex-shrink-0">
                        <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                        </div>
                        <ResponsiveContainer width={80} height={48}>
                            <RadialBarChart innerRadius="70%" outerRadius="100%" barSize={7} data={[{ value: pctCumplimiento }]} startAngle={180} endAngle={0}>
                                <PolarAngleAxis type="number" domain={[0, 150]} tick={false} />
                                <RadialBar background dataKey="value" cornerRadius={7} fill="#D30B15" />
                            </RadialBarChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Badge className="w-fit">Previsto: {previsto != null ? formatValue(previsto) : 'Sin datos'}</Badge>
                        <Badge className="w-fit">Real: {real != null ? formatValue(real) : 'Sin datos'}</Badge>
                        <span className="flex items-center gap-1 text-xs font-semibold text-secondary-foreground">
                            {pct != null && (pct >= 0 ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
                            {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : 'Sin datos'}
                        </span>
                        {warning && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex w-fit items-center gap-1 text-xs font-medium text-amber-600 hover:underline decoration-dotted underline-offset-2"
                                    >
                                        <AlertTriangle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                                        {warning.text}
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[320px] p-3" align="start">
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                        Artículos sin gramaje (F554101)
                                    </p>
                                    <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                                        {warning.items.map(it => (
                                            <li key={it.item} className="flex flex-col border-b border-border pb-1 last:border-0">
                                                <span className="font-medium">{it.item}</span>
                                                {it.descripcion && <span className="text-xs text-muted-foreground">{it.descripcion}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default function ComprasPage() {
    const router = useRouter()
    const { toast } = useToast()
    const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
    const [showPresets, setShowPresets] = useState(false)
    const { presets, reload: reloadPresets } = usePresets('compras')

    const [tab, setTab] = useState<Metrica>('cantidad')
    // ponytail: por defecto "este mes", no el año — sin filtro SDNXTR el año completo escanea
    // ~165.000 líneas de F4211 y tarda ~2,5min (ver docs/compras.md §3.3/§11); el mes es rápido.
    const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('mes_actual')
    const initialRange = presetToRange('mes_actual')!
    const [filters, setFilters] = useState({ startDate: initialRange.startDate, endDate: initialRange.endDate })
    const [selectedItems, setSelectedItems] = useState<string[]>([])
    const [selectedMarcas, setSelectedMarcas] = useState<string[]>([])

    const [rows, setRows] = useState<Row[]>([])
    const [resumen, setResumen] = useState<Resumen>(RESUMEN_VACIO)
    const [availableArticles, setAvailableArticles] = useState<{ id: string; description: string }[]>([])
    const [availableMarcas, setAvailableMarcas] = useState<{ id: string; description: string }[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searched, setSearched] = useState(false)

    const filtersRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const checkAccess = async () => {
            try {
                const res = await fetch('/api/auth/me')
                const user = res.ok ? await res.json() : null
                if (user?.mustChangePassword) { router.push('/cambiar-contrasena'); return }
                setSessionUser(user)
                const screensRes = await fetch('/api/screen-permissions')
                if (screensRes.ok) {
                    const screens = await screensRes.json()
                    const mine = screens['compras']
                    if (mine && !mine.is_public) {
                        if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
                            router.push('/login')
                            return
                        }
                    }
                }
            } catch { }
        }
        checkAccess()
    }, [])

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        setSessionUser(null)
    }

    const fetchData = useCallback(async (f: typeof filters, items: string[], marcas: string[]) => {
        setLoading(true)
        setError(null)
        setSearched(true)
        try {
            const params = new URLSearchParams()
            if (f.startDate) params.set('startDate', f.startDate)
            if (f.endDate) params.set('endDate', f.endDate)
            items.forEach(it => params.append('item', it))
            marcas.forEach(m => params.append('marca', m))
            const res = await fetch(`/api/compras?${params}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
            setRows(data.rows || [])
            setResumen(data.resumen || RESUMEN_VACIO)
            const articleMap = new Map<string, string>()
            ;(data.rows || []).forEach((r: Row) => { if (!articleMap.has(r.item)) articleMap.set(r.item, r.descripcion) })
            setAvailableArticles(Array.from(articleMap, ([id, description]) => ({ id, description })))
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error desconocido'
            setError(msg)
            toast(msg, 'error')
        } finally {
            setLoading(false)
        }
    }, [toast])

    // Carga inicial con el rango por defecto (año actual)
    useEffect(() => { fetchData(filters, selectedItems, selectedMarcas) }, [])

    // Opciones de Marca (IMSRP4, mismo campo/patrón que el filtro Marca de /produccion)
    useEffect(() => {
        fetch('/api/categories?field=srp4&screen=compras')
            .then(res => res.ok ? res.json() : [])
            .then(data => setAvailableMarcas(Array.isArray(data) ? data : []))
            .catch(() => setAvailableMarcas([]))
    }, [])

    const handlePeriodChange = (preset: PeriodPreset) => {
        setPeriodPreset(preset)
        if (preset === 'personalizado') {
            filtersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
        }
        const range = presetToRange(preset)
        if (range) {
            setFilters(range)
            fetchData(range, selectedItems, selectedMarcas)
        }
    }

    const applyFilters = () => {
        setPeriodPreset('personalizado')
        fetchData(filters, selectedItems, selectedMarcas)
    }

    const clearFilters = () => {
        const range = presetToRange('mes_actual')!
        setPeriodPreset('mes_actual')
        setFilters(range)
        setSelectedItems([])
        setSelectedMarcas([])
        fetchData(range, [], [])
    }

    const getPresetFilters = () => ({ startDate: filters.startDate, endDate: filters.endDate, selectedItems, selectedMarcas })
    const applyPresetFilters = (f: Record<string, unknown>) => {
        // Si el preset no incluye fechas (checkbox "Incluir fechas" desmarcado al guardarlo),
        // se mantiene el rango actual en vez de vaciarlo.
        const next = {
            startDate: (f.startDate as string) || filters.startDate,
            endDate: (f.endDate as string) || filters.endDate,
        }
        const items = (f.selectedItems as string[]) || []
        const marcas = (f.selectedMarcas as string[]) || []
        setPeriodPreset('personalizado')
        setFilters(next)
        setSelectedItems(items)
        setSelectedMarcas(marcas)
        fetchData(next, items, marcas)
    }

    // Serie de tendencia según la métrica de la pestaña activa
    const trendData = useMemo(() => resumen.porMes.map(m => ({
        mesLabel: m.mesLabel,
        previsto: tab === 'cantidad' ? m.cantidadPrevisto : tab === 'kg' ? m.kgPrevisto : tab === 'importe' ? m.importePrevisto : m.precioPrevisto,
        real: tab === 'cantidad' ? m.cantidadReal : tab === 'kg' ? m.kgReal : tab === 'importe' ? m.importeReal : m.precioReal,
    })), [resumen, tab])

    const formatMetric = tab === 'cantidad' ? fmtCantidad : tab === 'kg' ? fmtKg : tab === 'importe' ? fmtEur : fmtPrecioUnitario

    // Descripción por artículo (para enriquecer la lista de "sin gramaje" con algo más que el código)
    const articulosSinGramajeConDescripcion = useMemo(() => {
        const descripcionPorItem = new Map<string, string>()
        rows.forEach(r => { if (!descripcionPorItem.has(r.item)) descripcionPorItem.set(r.item, r.descripcion) })
        return resumen.articulosSinGramaje.map(item => ({ item, descripcion: descripcionPorItem.get(item) || '' }))
    }, [resumen, rows])

    // Exporta la comparativa completa (las 4 métricas, no solo la pestaña activa) a un único Excel
    // con 3 hojas: Resumen, Tendencia mensual y Detalle por artículo/mes.
    const exportToExcel = () => {
        const wb = XLSX.utils.book_new()

        // --- Hoja "Resumen" ---
        const articulosDesc = selectedItems.length > 0 ? selectedItems.join(', ') : 'Todos'
        const marcasDesc = selectedMarcas.length > 0 ? selectedMarcas.join(', ') : 'Todas'
        const resumenAoa: (string | number)[][] = [
            ['Comparativa de compras — Previsión vs. Real'],
            [`Periodo: ${filters.startDate} a ${filters.endDate}`],
            [`Artículos: ${articulosDesc}    Marca: ${marcasDesc}`],
            [],
            ['Métrica', 'Previsto', 'Real', 'Desviación', 'Desviación %'],
            ['Unidades', resumen.totalCantidadPrevisto, resumen.totalCantidadReal,
                resumen.totalCantidadReal - resumen.totalCantidadPrevisto, (resumen.desviacionCantidadPct ?? 0) / 100],
            ['Kg', resumen.totalKgPrevisto, resumen.totalKgReal,
                resumen.totalKgReal - resumen.totalKgPrevisto, (resumen.desviacionKgPct ?? 0) / 100],
            ['Importe (€)', resumen.totalImportePrevisto, resumen.totalImporteReal,
                resumen.totalImporteReal - resumen.totalImportePrevisto, (resumen.desviacionImportePct ?? 0) / 100],
            ['Precio medio (€/ud)', resumen.precioMedioPrevisto ?? '', resumen.precioMedioReal ?? '',
                (resumen.precioMedioReal ?? 0) - (resumen.precioMedioPrevisto ?? 0), (resumen.desviacionPrecioPct ?? 0) / 100],
        ]
        if (resumen.articulosSinGramaje.length > 0) {
            resumenAoa.push([], [`Artículos sin gramaje (Kg no calculable): ${resumen.articulosSinGramaje.join(', ')}`])
        }
        const wsResumen = XLSX.utils.aoa_to_sheet(resumenAoa)
        wsResumen['!merges'] = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
        ]
        wsResumen['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
        setColNumFmt(wsResumen, 1, 4, XLS_FMT_UD, 5)
        setColNumFmt(wsResumen, 2, 4, XLS_FMT_UD, 5)
        setColNumFmt(wsResumen, 3, 4, XLS_FMT_UD, 5)
        setColNumFmt(wsResumen, 4, 4, XLS_FMT_PCT, 5)
        XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen')

        // --- Hoja "Tendencia mensual" ---
        const tendenciaRows = resumen.porMes.map(m => ({
            'Mes': m.mesLabel,
            'Unidades previsto': m.cantidadPrevisto, 'Unidades real': m.cantidadReal,
            'Kg previsto': m.kgPrevisto, 'Kg real': m.kgReal,
            'Importe previsto (€)': m.importePrevisto, 'Importe real (€)': m.importeReal,
            'Precio previsto (€/ud)': m.precioPrevisto ?? '', 'Precio real (€/ud)': m.precioReal ?? '',
        }))
        const wsTendencia = XLSX.utils.json_to_sheet(tendenciaRows)
        wsTendencia['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]
        setColNumFmt(wsTendencia, 1, tendenciaRows.length, XLS_FMT_UD)
        setColNumFmt(wsTendencia, 2, tendenciaRows.length, XLS_FMT_UD)
        setColNumFmt(wsTendencia, 3, tendenciaRows.length, XLS_FMT_KG)
        setColNumFmt(wsTendencia, 4, tendenciaRows.length, XLS_FMT_KG)
        setColNumFmt(wsTendencia, 5, tendenciaRows.length, XLS_FMT_EUR)
        setColNumFmt(wsTendencia, 6, tendenciaRows.length, XLS_FMT_EUR)
        setColNumFmt(wsTendencia, 7, tendenciaRows.length, XLS_FMT_EUR)
        setColNumFmt(wsTendencia, 8, tendenciaRows.length, XLS_FMT_EUR)
        XLSX.utils.book_append_sheet(wb, wsTendencia, 'Tendencia mensual')

        // --- Hoja "Detalle" (las 4 métricas para cada artículo+mes, no solo la pestaña activa) ---
        const detalleRows = rows.map(r => ({
            'Mes': r.mesLabel, 'Artículo': r.item, 'Descripción': r.descripcion,
            'Familia': r.familia, 'Marca': r.marca, 'Gramaje (g)': r.gramaje ?? '',
            'Unid. previsto': r.previsto.cantidad ?? '', 'Unid. real': r.real.cantidad ?? '',
            'Desv. unid.': r.desviacion.cantidad.abs ?? '', 'Desv. unid. %': r.desviacion.cantidad.pct != null ? r.desviacion.cantidad.pct / 100 : '',
            'Kg previsto': r.previsto.kg ?? '', 'Kg real': r.real.kg ?? '',
            'Desv. kg': r.desviacion.kg.abs ?? '', 'Desv. kg %': r.desviacion.kg.pct != null ? r.desviacion.kg.pct / 100 : '',
            'Importe previsto (€)': r.previsto.importe ?? '', 'Importe real (€)': r.real.importe ?? '',
            'Desv. importe (€)': r.desviacion.importe.abs ?? '', 'Desv. importe %': r.desviacion.importe.pct != null ? r.desviacion.importe.pct / 100 : '',
            'Precio previsto (€/ud)': r.previsto.precioUnitario ?? '', 'Precio real (€/ud)': r.real.precioUnitario ?? '',
            'Desv. precio (€/ud)': r.desviacion.precio.abs ?? '', 'Desv. precio %': r.desviacion.precio.pct != null ? r.desviacion.precio.pct / 100 : '',
            'Avisos': r.avisos.join(', '),
        }))
        const wsDetalle = XLSX.utils.json_to_sheet(detalleRows)
        wsDetalle['!cols'] = [
            { wch: 10 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 10 },
            { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 11 },
            { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 10 },
            { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 12 },
            { wch: 15 }, { wch: 13 }, { wch: 13 }, { wch: 11 },
            { wch: 30 },
        ]
        const n = detalleRows.length
        setColNumFmt(wsDetalle, 5, n, XLS_FMT_UD)   // Gramaje
        setColNumFmt(wsDetalle, 6, n, XLS_FMT_UD); setColNumFmt(wsDetalle, 7, n, XLS_FMT_UD); setColNumFmt(wsDetalle, 8, n, XLS_FMT_UD)
        setColNumFmt(wsDetalle, 9, n, XLS_FMT_PCT)
        setColNumFmt(wsDetalle, 10, n, XLS_FMT_KG); setColNumFmt(wsDetalle, 11, n, XLS_FMT_KG); setColNumFmt(wsDetalle, 12, n, XLS_FMT_KG)
        setColNumFmt(wsDetalle, 13, n, XLS_FMT_PCT)
        setColNumFmt(wsDetalle, 14, n, XLS_FMT_EUR); setColNumFmt(wsDetalle, 15, n, XLS_FMT_EUR); setColNumFmt(wsDetalle, 16, n, XLS_FMT_EUR)
        setColNumFmt(wsDetalle, 17, n, XLS_FMT_PCT)
        setColNumFmt(wsDetalle, 18, n, XLS_FMT_EUR); setColNumFmt(wsDetalle, 19, n, XLS_FMT_EUR); setColNumFmt(wsDetalle, 20, n, XLS_FMT_EUR)
        setColNumFmt(wsDetalle, 21, n, XLS_FMT_PCT)
        XLSX.utils.book_append_sheet(wb, wsDetalle, 'Detalle')

        XLSX.writeFile(wb, `Compras_${filters.startDate}_${filters.endDate}.xlsx`)
    }

    return (
        <AppShell
            navbar={{ currentPanel: 'compras', user: sessionUser, onLogout: logout, onPresetsClick: () => setShowPresets(s => !s) }}
            title="Compras"
            description="Previsión de ventas vs. venta real, por artículo y mes"
        >
            {showPresets && (
                <PresetPanel
                    screen="compras"
                    presets={presets}
                    onReload={reloadPresets}
                    open={showPresets}
                    onClose={() => setShowPresets(false)}
                    getFilters={getPresetFilters}
                    applyFilters={applyPresetFilters}
                    dateFields={['startDate', 'endDate']}
                    hint="Se guardarán los artículos y marcas seleccionados."
                />
            )}

            {/* overflow-visible: Card accent trae overflow-hidden (para la barra superior redondeada),
                pero eso recortaba el desplegable absolute de ArticleMultiSelect. */}
            <Card accent className="overflow-visible p-4 space-y-4" ref={filtersRef}>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="grid gap-1.5">
                        <label className="text-xs font-semibold text-secondary-foreground">Desde</label>
                        <DatePicker value={filters.startDate} onChange={v => setFilters(f => ({ ...f, startDate: v }))} />
                    </div>
                    <div className="grid gap-1.5">
                        <label className="text-xs font-semibold text-secondary-foreground">Hasta</label>
                        <DatePicker value={filters.endDate} onChange={v => setFilters(f => ({ ...f, endDate: v }))} />
                    </div>
                    <div className="grid gap-1.5 min-w-[240px]">
                        <label className="text-xs font-semibold text-secondary-foreground">Artículos</label>
                        <ArticleMultiSelect articles={availableArticles} selected={selectedItems} onChange={setSelectedItems} />
                    </div>
                    <div className="grid gap-1.5 min-w-[170px]">
                        <label className="text-xs font-semibold text-secondary-foreground">Marca</label>
                        <ArticleMultiSelect articles={availableMarcas} selected={selectedMarcas} onChange={setSelectedMarcas} label="Marca" />
                    </div>
                    <PresetQuickSelect presets={presets} onSelect={(p) => applyPresetFilters(JSON.parse(p.filters))} />
                    <div className="flex gap-2">
                        <Button type="button" onClick={applyFilters}>Filtrar</Button>
                        <Button type="button" variant="outline" onClick={clearFilters}>Limpiar</Button>
                        <Button type="button" variant="outline" onClick={exportToExcel} disabled={rows.length === 0}
                            className="border-green-600 text-green-700 hover:bg-green-50">
                            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                            Excel
                        </Button>
                    </div>
                </div>
            </Card>

            {loading && <Spinner label="Consultando previsión y ventas..." className="py-10" />}

            {!loading && searched && !error && (
                <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <DesviacionCard titulo="Unidades" icon={Boxes} previsto={resumen.totalCantidadPrevisto} real={resumen.totalCantidadReal}
                            pct={resumen.desviacionCantidadPct} formatValue={fmtCantidad} periodPreset={periodPreset} onPeriodChange={handlePeriodChange} />
                        <DesviacionCard titulo="Kg" icon={Scale} previsto={resumen.totalKgPrevisto} real={resumen.totalKgReal}
                            pct={resumen.desviacionKgPct} formatValue={fmtKg} periodPreset={periodPreset} onPeriodChange={handlePeriodChange}
                            warning={resumen.articulosSinGramaje.length > 0 ? {
                                text: `${resumen.articulosSinGramaje.length} sin gramaje`,
                                items: articulosSinGramajeConDescripcion,
                            } : undefined} />
                        <DesviacionCard titulo="Importe" icon={Euro} previsto={resumen.totalImportePrevisto} real={resumen.totalImporteReal}
                            pct={resumen.desviacionImportePct} formatValue={fmtEur} periodPreset={periodPreset} onPeriodChange={handlePeriodChange} />
                        <DesviacionCard titulo="Precio" icon={Tag} previsto={resumen.precioMedioPrevisto} real={resumen.precioMedioReal}
                            pct={resumen.desviacionPrecioPct} formatValue={fmtPrecioUnitario} periodPreset={periodPreset} onPeriodChange={handlePeriodChange} />
                    </div>

                    <Card accent>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-bold text-secondary-foreground">Tendencia mensual</CardTitle>
                            <PeriodPresetSelect value={periodPreset} onChange={handlePeriodChange} />
                        </CardHeader>
                        <CardContent>
                            {trendData.length === 0 ? (
                                <EmptyState icon={ShoppingCart} title="Sin datos en el rango" className="py-8" />
                            ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart data={trendData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis dataKey="mesLabel" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="previsto" name="Previsto" stroke="#6b7280" strokeWidth={2} dot={{ r: 3, fill: '#6b7280' }} />
                                        <Line type="monotone" dataKey="real" name="Real" stroke="#D30B15" strokeWidth={2} dot={{ r: 3, fill: '#D30B15' }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>

                    <Tabs
                        value={tab}
                        onValueChange={(v) => setTab(v as Metrica)}
                        tabs={[
                            { value: 'cantidad', label: 'Unidades' },
                            { value: 'kg', label: 'Kg' },
                            { value: 'importe', label: 'Importe (€)' },
                            { value: 'precio', label: 'Precio unitario (€)' },
                        ]}
                    />

                    <Card accent>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-bold text-secondary-foreground">Detalle por artículo</CardTitle>
                            <PeriodPresetSelect value={periodPreset} onChange={handlePeriodChange} />
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                            <TableHead className="font-bold text-secondary-foreground">Mes</TableHead>
                                            <TableHead className="font-bold text-secondary-foreground">Artículo</TableHead>
                                            <TableHead className="text-right font-bold text-secondary-foreground">Previsto</TableHead>
                                            <TableHead className="text-right font-bold text-secondary-foreground">Real</TableHead>
                                            <TableHead className="text-right font-bold text-secondary-foreground">Desviación</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rows.length === 0 ? (
                                            <TableRow className="hover:bg-transparent">
                                                <TableCell colSpan={5}>
                                                    <EmptyState icon={ShoppingCart} title="Sin datos" description="No hay previsión ni ventas para este rango/filtro." />
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            rows.map((r, i) => {
                                                const d = r.desviacion[tab]
                                                const prevVal = tab === 'cantidad' ? r.previsto.cantidad : tab === 'kg' ? r.previsto.kg : tab === 'importe' ? r.previsto.importe : r.previsto.precioUnitario
                                                const realVal = tab === 'cantidad' ? r.real.cantidad : tab === 'kg' ? r.real.kg : tab === 'importe' ? r.real.importe : r.real.precioUnitario
                                                return (
                                                    <TableRow key={`${r.item}-${r.mesLabel}-${i}`}>
                                                        <TableCell className="text-sm text-secondary-foreground">{r.mesLabel}</TableCell>
                                                        <TableCell className="text-sm">
                                                            <div className="flex items-center gap-2">
                                                                <Package className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                                                                <div className="flex flex-col">
                                                                    <span className="font-medium">{r.item}</span>
                                                                    <span className="text-xs text-muted-foreground">{r.descripcion}</span>
                                                                </div>
                                                                {r.avisos.length > 0 && (
                                                                    <span title={r.avisos.join(', ')}><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" /></span>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right text-sm">{prevVal != null ? formatMetric(prevVal) : '—'}</TableCell>
                                                        <TableCell className="text-right text-sm">{realVal != null ? formatMetric(realVal) : '—'}</TableCell>
                                                        <TableCell className="text-right">
                                                            {d.pct != null ? (
                                                                <Badge className="ml-auto w-fit">
                                                                    {d.pct >= 0 ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />}
                                                                    {`${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(1)}%`}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground">Sin datos</span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}

            {!loading && error && (
                <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">{error}</span>
                </div>
            )}

            {!loading && !searched && (
                <EmptyState icon={ShoppingCart} title="Sin consulta todavía" description="Aplica un rango de fechas para ver la comparativa." className="py-16" />
            )}
        </AppShell>
    )
}
