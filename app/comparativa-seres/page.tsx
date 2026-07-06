"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { Loader2, Search, Download, X, AlertTriangle, CheckCircle2, ArrowLeftRight, ShieldAlert, SearchX } from "lucide-react"
import { AppShell } from "@/components/AppShell"
import { PresetPanel } from "@/components/PresetPanel"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { useRouter } from "next/navigation"
import * as XLSX from 'xlsx'

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

interface Pedido {
    referencia: string;
    fecha: string | null;
    hora?: string | null;
    tipo?: string;
    clienteCodigo?: string | null;
    clienteNombre?: string | null;
    shanNum?: number | null;
    shanDesc?: string | null;
    shanMlnm?: string | null;
    urabNum?: number | null;
    urabDesc?: string | null;
    // Estado del pedido en JDE (SYEDSP). Solo presente en filas con origen JDE.
    estado?: string | null;
}

// Etiqueta legible para cada código SYEDSP.
// Las descripciones reales se cargan desde SQLite via /api/jde-statuses
// (editables por admin). ESTADO_LABEL_FALLBACK actúa como red de seguridad
// si el fetch falla o aún no ha terminado al renderizar.
const ESTADO_LABEL_FALLBACK: Record<string, string> = {
    Y: 'Procesado',
    M: 'Modificado (duplicado)',
    N: 'Sin procesar',
    E: 'Error',
}
function estadoLabel(code?: string | null, customMap?: Record<string, string>): string {
    if (!code) return 'Desconocido'
    return customMap?.[code] || ESTADO_LABEL_FALLBACK[code] || `Otro (${code})`
}
// Variante semántica del Badge por estado. Y es el único "OK", el resto son incidencias.
function estadoBadgeVariant(code?: string | null): 'success' | 'warning' | 'default' | 'destructive' {
    switch (code) {
        case 'Y': return 'success'
        case 'M': return 'warning'
        case 'N': return 'default'
        case 'E': return 'destructive'
        default: return 'default'
    }
}

interface Resumen {
    total_seres_todos: number;
    total_seres_pedidos: number;
    total_jde: number;
    solo_en_seres: number;
    solo_en_jde: number;
    en_ambos: number;
    incidencias: number;
    incidencias_por_estado: Record<string, number>;
    days: number;
}

interface ComparativaResult {
    resumen: Resumen;
    solo_en_seres: Pedido[];
    solo_en_jde: Pedido[];
    en_ambos: Pedido[];
    incidencias: Pedido[];
}

type Tab = 'solo_seres' | 'solo_jde' | 'ambos' | 'incidencias'

function formatFecha(fecha: string | null | undefined) {
    if (!fecha) return '-'
    const [y, m, d] = fecha.split('-')
    return `${d}/${m}/${y}`
}

export default function ComparativaSeresPage() {
    const router = useRouter()
    const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<ComparativaResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [days, setDays] = useState(0)
    const [activeTab, setActiveTab] = useState<Tab>('solo_seres')
    const [selectedDestinoMlnm, setSelectedDestinoMlnm] = useState<string[]>([])

    // Descripciones de estados JDE cargadas desde la BD (editables en /admin).
    // Si el fetch falla, estadoLabel usa el fallback hardcodeado.
    const [statusDescriptions, setStatusDescriptions] = useState<Record<string, string>>({})

    // --- PRESETS ---
    // El sistema de presets es compartido por todos los paneles (tabla SQLite `presets`).
    // El estado y las llamadas a /api/presets viven en <PresetPanel screen="comparativa">;
    // aquí solo controlamos la visibilidad del panel.
    const [showPresets, setShowPresets] = useState(false)
    // Señal incrementada por el botón Presets del Navbar para abrir el panel desde fuera.
    const [presetsSignal, setPresetsSignal] = useState(0)
    useEffect(() => {
        if (presetsSignal > 0) setShowPresets(true)
    }, [presetsSignal])

    // Comprobar sesión al montar
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
                    const mine = screens['comparativa']
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

    const fetchData = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/comparativa-seres?days=${days}`)
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || `Error ${res.status}`)
            }
            const data: ComparativaResult = await res.json()
            setResult(data)
            setActiveTab('solo_seres')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error desconocido')
        } finally {
            setLoading(false)
        }
    }

    const clearFilters = () => {
        setResult(null)
        setError(null)
        setDays(0)
        setSelectedDestinoMlnm([])
    }

    // Descripciones JDE (requiere sesión)
    useEffect(() => {
        if (sessionUser) {
            fetch('/api/jde-statuses')
                .then(r => r.ok ? r.json() : [])
                .then((rows: { code: string; description: string }[]) => {
                    const map: Record<string, string> = {}
                    rows.forEach(r => { map[r.code] = r.description })
                    setStatusDescriptions(map)
                })
                .catch(err => console.error('No se pudieron cargar las descripciones de estado JDE:', err))
        }
    }, [sessionUser])

    const exportToExcel = () => {
        if (!result) return
        const wb = XLSX.utils.book_new()

        // Fila JDE enriquecida: Destino + Comprador + Estado JDE (código + descripción de la BD).
        // Se usa en las hojas "Solo en JDE", "En ambos" e "Incidencias".
        const toJdeRow = (p: Pedido) => ({
            Referencia: p.referencia,
            Fecha: formatFecha(p.fecha),
            'Nº Destino': p.shanNum ?? '',
            'Desc. Destino': p.shanDesc ?? '',
            Cliente: p.shanMlnm ?? '',
            'Nº Comprador': p.urabNum ?? '',
            'Desc. Comprador': p.urabDesc ?? '',
            'Estado JDE': p.estado ? `${p.estado} - ${estadoLabel(p.estado, statusDescriptions)}` : '',
        })
        const soloSeresRows = result.solo_en_seres.map(p => ({
            Referencia: p.referencia,
            Fecha: formatFecha(p.fecha),
            'Cód. Cliente': p.clienteCodigo ?? '',
            Cliente: p.clienteNombre ?? '',
            Tipo: p.tipo ?? '',
        }))

        // Helper: aplica formato condicional rojo a las celdas de Estado JDE
        // cuando el código empieza por 'E'. Columna "Estado JDE" es la 8ª (índice 7).
        const ESTADO_COL_IDX = 7
        const paintErrors = (ws: XLSX.WorkSheet, rows: ReturnType<typeof toJdeRow>[]) => {
            for (let r = 0; r < rows.length; r++) {
                if (rows[r]['Estado JDE'].startsWith('E')) {
                    const ref = XLSX.utils.encode_cell({ r: r + 1, c: ESTADO_COL_IDX })
                    if (ws[ref]) {
                        ws[ref].s = {
                            fill: { fgColor: { rgb: 'FECACA' } },
                            font: { bold: true, color: { rgb: 'B91C1C' } },
                        }
                    }
                }
            }
        }

        const wsSoloSeres = XLSX.utils.json_to_sheet(soloSeresRows)
        const soloJdeRows = result.solo_en_jde.map(toJdeRow)
        const wsSoloJde = XLSX.utils.json_to_sheet(soloJdeRows)
        paintErrors(wsSoloJde, soloJdeRows)
        const ambosRows = result.en_ambos.map(toJdeRow)
        const wsAmbos = XLSX.utils.json_to_sheet(ambosRows)
        paintErrors(wsAmbos, ambosRows)

        XLSX.utils.book_append_sheet(wb, wsSoloSeres, 'Solo en SERES')
        XLSX.utils.book_append_sheet(wb, wsSoloJde, 'Solo en JDE')
        XLSX.utils.book_append_sheet(wb, wsAmbos, 'En ambos')

        // Hoja "Incidencias" — solo si hay alguna. Mismo formato que JDE.
        if (result.incidencias && result.incidencias.length > 0) {
            const incRows = result.incidencias.map(toJdeRow)
            const wsInc = XLSX.utils.json_to_sheet(incRows)
            paintErrors(wsInc, incRows)
            XLSX.utils.book_append_sheet(wb, wsInc, 'Incidencias JDE')
        }

        XLSX.writeFile(wb, `Comparativa_SERES_JDE_${new Date().toISOString().split('T')[0]}.xlsx`)
    }

    const filterByMlnm = (rows: Pedido[]) => {
        if (selectedDestinoMlnm.length === 0) return rows
        return rows.filter(p => selectedDestinoMlnm.includes(p.shanMlnm ?? ''))
    }

    const availableDestinoMlnm = result
        ? Array.from(new Set([
            ...result.solo_en_jde.map(p => p.shanMlnm ?? ''),
            ...result.en_ambos.map(p => p.shanMlnm ?? ''),
            ...(result.incidencias || []).map(p => p.shanMlnm ?? ''),
          ].filter(Boolean))).sort().map(v => ({ id: v, description: v }))
        : []

    const tabData: Record<Tab, Pedido[]> = result
        ? {
            solo_seres: result.solo_en_seres,
            solo_jde:   filterByMlnm(result.solo_en_jde),
            ambos:      filterByMlnm(result.en_ambos),
            incidencias: filterByMlnm(result.incidencias || []),
          }
        : { solo_seres: [], solo_jde: [], ambos: [], incidencias: [] }

    const dayOptions = [
        { value: 0, label: 'Hoy' },
        { value: 1, label: '1 día' },
        { value: 3, label: '3 días' },
        { value: 7, label: '7 días' },
        { value: 14, label: '14 días' },
        { value: 30, label: '30 días' },
    ]

    return (
        <AppShell
            navbar={{
                currentPanel: "comparativa",
                user: sessionUser,
                onLogout: logout,
                onPresetsClick: () => setPresetsSignal(s => s + 1),
            }}
            title="Comparativa SERES"
            description="Contraste de pedidos EDI (SERES) frente a órdenes en JDE"
        >
                {/* --- PANEL DE PRESETS (componente compartido, mismo patrón que el resto de paneles) --- */}
                {sessionUser && (
                    <PresetPanel
                        screen="comparativa"
                        open={showPresets}
                        onClose={() => setShowPresets(false)}
                        getFilters={() => ({ days, selectedDestinoMlnm })}
                        applyFilters={(f) => {
                            setDays(typeof f.days === 'number' ? f.days : 0)
                            setSelectedDestinoMlnm(Array.isArray(f.selectedDestinoMlnm) ? f.selectedDestinoMlnm : [])
                        }}
                        hint="Se guardarán el periodo y los clientes seleccionados."
                    />
                )}

                {/* --- FILTROS --- */}
                <Card accent className="space-y-4 p-4">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Filtros</p>
                        <div className="flex flex-wrap items-end gap-3">
                            {/* Rango de días */}
                            <div className="grid gap-1.5">
                                <label htmlFor="comp-days" className="text-xs font-semibold text-secondary-foreground">Periodo</label>
                                <div className="flex rounded-md overflow-hidden border border-input">
                                    {dayOptions.map(opt => (
                                        <button
                                            type="button"
                                            key={opt.value}
                                            onClick={() => setDays(opt.value)}
                                            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${days === opt.value ? 'bg-primary text-primary-foreground' : 'bg-card text-secondary-foreground hover:bg-muted/50'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Cliente (F0111.WWMLNM) */}
                            <div className="grid gap-1.5">
                                <label className="text-xs font-semibold text-secondary-foreground">
                                    Cliente
                                    {availableDestinoMlnm.length > 0 && (
                                        <span className="ml-1 text-muted-foreground font-normal">({availableDestinoMlnm.length})</span>
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
                        </div>
                    </div>

                    <div className="border-t border-border" />

                    {/* Acciones */}
                    <div className="flex flex-wrap items-center gap-3 justify-between">
                        <div className="flex gap-3">
                            <Button onClick={fetchData} disabled={loading} className="font-semibold">
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-2 h-4 w-4" aria-hidden="true" />}
                                Comparar
                            </Button>
                            <Button onClick={exportToExcel} variant="outline" disabled={!result} className="border-green-600 text-green-700 hover:bg-green-50">
                                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                                Excel
                            </Button>
                            <Button onClick={clearFilters} variant="outline" className="text-secondary-foreground">
                                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                                Limpiar
                            </Button>
                        </div>
                        {loading && (
                            <p className="text-xs text-muted-foreground italic">Consultando SERES y JDE… puede tardar unos segundos.</p>
                        )}
                    </div>
                </Card>

                {/* --- ERROR --- */}
                {error && (
                    <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                )}

                {/* --- TARJETAS METRICAS ---
                    Solo las 4 KPIs accionables (Solo SERES + Solo JDE + En ambos + Incidencias).
                    El total bruto de cada sistema no se muestra: era redundante
                    (Solo+En ambos ya es el total visible) y con days=0 confundía
                    porque la consulta JDE incluye ayer por el fix de reprocesado. */}
                {result && (
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                        <Card className="overflow-hidden border-t-[3px] border-t-amber-500 cursor-pointer transition-shadow hover:shadow-md" onClick={() => setActiveTab('solo_seres')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-secondary-foreground">Solo en SERES</CardTitle>
                                <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-amber-600">{tabData.solo_seres.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-muted-foreground font-medium">no están en JDE</p>
                            </CardContent>
                        </Card>

                        <Card className="overflow-hidden border-t-[3px] border-t-red-500 cursor-pointer transition-shadow hover:shadow-md" onClick={() => setActiveTab('solo_jde')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-secondary-foreground">Solo en JDE</CardTitle>
                                <AlertTriangle className="h-4 w-4 text-red-500" aria-hidden="true" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-red-600">{tabData.solo_jde.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-muted-foreground font-medium">no están en SERES</p>
                            </CardContent>
                        </Card>

                        <Card className="overflow-hidden border-t-[3px] border-t-green-500 cursor-pointer transition-shadow hover:shadow-md" onClick={() => setActiveTab('ambos')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-secondary-foreground">En ambos</CardTitle>
                                <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-green-600">{tabData.ambos.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-muted-foreground font-medium">sincronizados</p>
                            </CardContent>
                        </Card>

                        {/* KPI 'Incidencias': todos los JDE con SYEDSP != 'Y'. Pulsar la card va a la pestaña Incidencias. */}
                        <Card
                            className="overflow-hidden border-t-[3px] border-t-orange-500 cursor-pointer transition-shadow hover:shadow-md"
                            onClick={() => setActiveTab('incidencias')}
                            title="Pedidos JDE con estado distinto de 'Procesado' (Y)"
                        >
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-secondary-foreground">Incidencias JDE</CardTitle>
                                <ShieldAlert className="h-4 w-4 text-orange-500" aria-hidden="true" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-orange-600">{tabData.incidencias.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-muted-foreground font-medium">
                                    {(() => {
                                        const byEstado = result.resumen.incidencias_por_estado || {}
                                        const parts: string[] = []
                                        if (byEstado.E) parts.push(`${byEstado.E} E`)
                                        if (byEstado.M) parts.push(`${byEstado.M} M`)
                                        if (byEstado.N) parts.push(`${byEstado.N} N`)
                                        return parts.length > 0 ? parts.join(' · ') : 'sin incidencias'
                                    })()}
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* --- TABLA CON TABS --- */}
                {result && (
                    <Card accent className="overflow-hidden">

                        {/* Tabs (componente compartido; el contenido lo decide activeTab) */}
                        <Tabs
                            value={activeTab}
                            onValueChange={(v) => setActiveTab(v as Tab)}
                            className="px-4 pt-3"
                            tabs={[
                                { value: 'solo_seres', label: 'Solo en SERES', count: tabData.solo_seres.length },
                                { value: 'solo_jde', label: 'Solo en JDE', count: tabData.solo_jde.length },
                                { value: 'ambos', label: 'En ambos', count: tabData.ambos.length },
                                { value: 'incidencias', label: 'Incidencias JDE', count: tabData.incidencias.length },
                            ]}
                        />

                        {/* Aviso contextual */}
                        <div className="px-4 pt-3">
                            {activeTab === 'solo_seres' && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                    <AlertTriangle className="inline h-3.5 w-3.5 mr-1 mb-0.5" aria-hidden="true" />
                                    Pedidos recibidos en SERES por EDI que <strong>no se han volcado en JDE</strong>. Revisar si se han creado manualmente.
                                </p>
                            )}
                            {activeTab === 'solo_jde' && (
                                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    <AlertTriangle className="inline h-3.5 w-3.5 mr-1 mb-0.5" aria-hidden="true" />
                                    Pedidos en JDE que <strong>no aparecen en SERES</strong>.
                                </p>
                            )}
                            {activeTab === 'ambos' && (
                                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                                    <CheckCircle2 className="inline h-3.5 w-3.5 mr-1 mb-0.5" aria-hidden="true" />
                                    Pedidos correctamente <strong>sincronizados</strong> en ambos sistemas.
                                </p>
                            )}
                            {activeTab === 'incidencias' && (
                                <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
                                    <ShieldAlert className="inline h-3.5 w-3.5 mr-1 mb-0.5" aria-hidden="true" />
                                    Pedidos JDE con <strong>estado distinto de Procesado (Y)</strong>: M (duplicado), N (sin procesar) o E (error). Requieren revisión.
                                </p>
                            )}
                        </div>

                        {/* Tabla */}
                        <div className="p-4">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-bold text-secondary-foreground">Referencia</TableHead>
                                        <TableHead className="font-bold text-secondary-foreground">Fecha</TableHead>
                                        {activeTab !== 'solo_seres' && (
                                            <>
                                                <TableHead className="font-bold text-secondary-foreground">Nº Destino</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Desc. Destino</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Cliente</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Nº Comprador</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Desc. Comprador</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground text-center">Estado JDE</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Descripción</TableHead>
                                            </>
                                        )}
                                        {activeTab === 'solo_seres' && (
                                            <>
                                                <TableHead className="font-bold text-secondary-foreground">Cliente</TableHead>
                                                <TableHead className="font-bold text-secondary-foreground">Tipo</TableHead>
                                            </>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tabData[activeTab].length === 0 ? (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={activeTab === 'solo_seres' ? 4 : 9}>
                                                <EmptyState
                                                    icon={SearchX}
                                                    title="Sin resultados"
                                                    description="No hay registros en esta categoría."
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        tabData[activeTab].map((p, i) => (
                                            <TableRow key={i}>
                                                <TableCell className="font-mono text-sm font-semibold text-foreground">{p.referencia}</TableCell>
                                                <TableCell className="text-secondary-foreground text-sm">
                                                    {formatFecha(p.fecha)}
                                                    {p.hora && <span className="ml-1.5 text-xs text-muted-foreground">{p.hora}</span>}
                                                </TableCell>
                                                {activeTab !== 'solo_seres' && (
                                                    <>
                                                        <TableCell className="font-mono text-sm text-secondary-foreground">{p.shanNum ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-secondary-foreground">{p.shanDesc ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-secondary-foreground">{p.shanMlnm ?? '-'}</TableCell>
                                                        <TableCell className="font-mono text-sm text-secondary-foreground">{p.urabNum ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-secondary-foreground">{p.urabDesc ?? '-'}</TableCell>
                                                        <TableCell className="text-center">
                                                            <Badge
                                                                variant={estadoBadgeVariant(p.estado)}
                                                                className="font-bold"
                                                                title={estadoLabel(p.estado, statusDescriptions)}
                                                            >
                                                                {p.estado || '?'}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-secondary-foreground max-w-[260px]">
                                                            {estadoLabel(p.estado, statusDescriptions)}
                                                        </TableCell>
                                                    </>
                                                )}
                                                {activeTab === 'solo_seres' && (
                                                    <>
                                                        <TableCell className="text-sm text-foreground">
                                                            {p.clienteCodigo && (
                                                                <span className="text-xs text-muted-foreground font-mono mr-1.5">{p.clienteCodigo}</span>
                                                            )}
                                                            {p.clienteNombre || '-'}
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground text-xs">{p.tipo}</TableCell>
                                                    </>
                                                )}
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </Card>
                )}

                {/* Estado de carga (sin resultados previos en pantalla) */}
                {loading && !result && (
                    <Spinner label="Cargando comparativa..." className="py-10" />
                )}

                {/* Estado inicial */}
                {!result && !loading && !error && (
                    <EmptyState
                        icon={ArrowLeftRight}
                        title="Sin datos que mostrar"
                        description="Selecciona el periodo y pulsa Comparar."
                        className="py-16"
                    />
                )}

        </AppShell>
    )
}
