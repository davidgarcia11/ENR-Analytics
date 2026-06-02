"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Search, Download, X, AlertTriangle, CheckCircle2, ArrowLeftRight, BookmarkCheck, Save, Pencil, Trash2, ShieldAlert } from "lucide-react"
import Navbar from "@/components/Navbar"
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { useRouter } from "next/navigation"
import * as XLSX from 'xlsx'

interface Preset { id: number; name: string; filters: string; created_at: string }

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
// Tailwind classes por estado para el badge. Y es el único "OK", el resto son incidencias.
function estadoBadgeClasses(code?: string | null): string {
    switch (code) {
        case 'Y': return 'bg-green-100 text-green-800 border-green-200'
        case 'M': return 'bg-amber-100 text-amber-800 border-amber-200'
        case 'N': return 'bg-gray-100 text-gray-700 border-gray-200'
        case 'E': return 'bg-red-100 text-red-800 border-red-200'
        default: return 'bg-slate-100 text-slate-600 border-slate-200'
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
    // Aquí guardamos los filtros propios de este panel (días + clientes) bajo screen='comparativa'.
    const [presets, setPresets] = useState<Preset[]>([])
    const [showPresets, setShowPresets] = useState(false)
    const [presetName, setPresetName] = useState('')
    const [savingPreset, setSavingPreset] = useState(false)
    const [editingPresetId, setEditingPresetId] = useState<number | null>(null)
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
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const clearFilters = () => {
        setResult(null)
        setError(null)
        setDays(0)
        setSelectedDestinoMlnm([])
        setEditingPresetId(null)
        setPresetName('')
    }

    // --- PRESETS (helpers) ---

    // Carga los presets del usuario para este panel (screen=comparativa).
    const loadPresets = async () => {
        try {
            const res = await fetch('/api/presets?screen=comparativa')
            if (res.ok) setPresets(await res.json())
        } catch { }
    }

    // Carga la lista al disponer de sesión.
    useEffect(() => {
        if (sessionUser) {
            loadPresets()
            // Descripciones JDE (también requiere sesión)
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

    // Guarda (o actualiza si hay editingPresetId) los filtros vigentes como preset.
    const savePreset = async (nameOverride?: string) => {
        const name = (nameOverride ?? presetName).trim()
        if (!name) return
        setSavingPreset(true)
        try {
            const filtersData = { days, selectedDestinoMlnm }
            const isEditing = editingPresetId !== null
            const res = await fetch(isEditing ? `/api/presets/${editingPresetId}` : '/api/presets', {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, filters: filtersData, screen: 'comparativa' }),
            })
            if (res.ok) { setPresetName(''); setEditingPresetId(null); loadPresets() }
            else { const d = await res.json(); alert(d.error || 'Error al guardar') }
        } finally { setSavingPreset(false) }
    }

    // Restaura los filtros guardados en el preset.
    const loadPreset = (preset: Preset) => {
        try {
            const f = JSON.parse(preset.filters)
            setDays(typeof f.days === 'number' ? f.days : 0)
            setSelectedDestinoMlnm(Array.isArray(f.selectedDestinoMlnm) ? f.selectedDestinoMlnm : [])
            setShowPresets(false)
        } catch (err) {
            console.error('Preset inválido:', err)
        }
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
        <main className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
            <div className="mx-auto max-w-7xl space-y-8">

                {/* --- BARRA DE NAVEGACIÓN --- */}
                <Navbar
                    currentPanel="comparativa"
                    user={sessionUser}
                    onLogout={logout}
                    onPresetsClick={() => setPresetsSignal(s => s + 1)}
                />

                {/* --- PANEL DE PRESETS (mismo patrón visual que /produccion y /preparacion-pedidos) --- */}
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
                                <p className="text-[11px] text-gray-400 mt-1.5">Se guardarán el periodo y los clientes seleccionados.</p>
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

                {/* --- FILTROS --- */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4" style={{ borderTop: '3px solid #D30B15' }}>
                    <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Filtros</p>
                        <div className="flex flex-wrap items-end gap-3">
                            {/* Rango de días */}
                            <div className="grid gap-1.5">
                                <label htmlFor="comp-days" className="text-xs font-semibold text-gray-700">Periodo</label>
                                <div className="flex rounded-md overflow-hidden border border-gray-300">
                                    {dayOptions.map(opt => (
                                        <button
                                            type="button"
                                            key={opt.value}
                                            onClick={() => setDays(opt.value)}
                                            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${days === opt.value ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                            style={days === opt.value ? { backgroundColor: '#D30B15' } : {}}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

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
                        </div>
                    </div>

                    <div className="border-t border-gray-100" />

                    {/* Acciones */}
                    <div className="flex flex-wrap items-center gap-3 justify-between">
                        <div className="flex gap-3">
                            <Button onClick={fetchData} disabled={loading} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#b00a12')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#D30B15')}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                Comparar
                            </Button>
                            <Button onClick={exportToExcel} variant="outline" disabled={!result} className="border-green-600 text-green-700 hover:bg-green-50">
                                <Download className="mr-2 h-4 w-4" />
                                Excel
                            </Button>
                            <Button onClick={clearFilters} variant="outline" className="border-gray-400 text-gray-600 hover:bg-gray-50">
                                <X className="mr-2 h-4 w-4" />
                                Limpiar
                            </Button>
                        </div>
                        {loading && (
                            <p className="text-xs text-gray-400 italic">Consultando SERES y JDE… puede tardar unos segundos.</p>
                        )}
                    </div>
                </div>

                {/* --- ERROR --- */}
                {error && (
                    <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                )}

                {/* --- TARJETAS METRICAS --- */}
                {result && (
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                        <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">SERES</CardTitle>
                                <ArrowLeftRight className="h-4 w-4" style={{ color: '#D30B15' }} />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-gray-900">{result.resumen.total_seres_pedidos.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">de {result.resumen.total_seres_todos} docs totales</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">JDE</CardTitle>
                                <ArrowLeftRight className="h-4 w-4" style={{ color: '#D30B15' }} />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-gray-900">{result.resumen.total_jde.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">últimos {result.resumen.days} días</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: '3px solid #f59e0b' }} onClick={() => setActiveTab('solo_seres')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">Solo en SERES</CardTitle>
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-amber-600">{tabData.solo_seres.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">no están en JDE</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: '3px solid #ef4444' }} onClick={() => setActiveTab('solo_jde')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">Solo en JDE</CardTitle>
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-red-600">{tabData.solo_jde.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">no están en SERES</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: '3px solid #22c55e' }} onClick={() => setActiveTab('ambos')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">En ambos</CardTitle>
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-green-600">{tabData.ambos.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">sincronizados</p>
                            </CardContent>
                        </Card>

                        {/* KPI 'Incidencias': todos los JDE con SYEDSP != 'Y'. Pulsar la card va a la pestaña Incidencias. */}
                        <Card
                            className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                            style={{ borderTop: '3px solid #f97316' }}
                            onClick={() => setActiveTab('incidencias')}
                            title="Pedidos JDE con estado distinto de 'Procesado' (Y)"
                        >
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">Incidencias JDE</CardTitle>
                                <ShieldAlert className="h-4 w-4 text-orange-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-orange-600">{tabData.incidencias.length.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">
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
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>

                        {/* Tabs */}
                        <div className="border-b border-gray-200 px-4 flex gap-1 pt-3">
                            <button
                                type="button"
                                onClick={() => setActiveTab('solo_seres')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'solo_seres' ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Solo en SERES
                                <span className="ml-2 bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {tabData.solo_seres.length}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('solo_jde')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'solo_jde' ? 'border-red-500 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Solo en JDE
                                <span className="ml-2 bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {tabData.solo_jde.length}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('ambos')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'ambos' ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                En ambos
                                <span className="ml-2 bg-green-100 text-green-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {tabData.ambos.length}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('incidencias')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'incidencias' ? 'border-orange-500 text-orange-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Incidencias JDE
                                <span className="ml-2 bg-orange-100 text-orange-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {tabData.incidencias.length}
                                </span>
                            </button>
                        </div>

                        {/* Aviso contextual */}
                        <div className="px-4 pt-3">
                            {activeTab === 'solo_seres' && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                    <AlertTriangle className="inline h-3.5 w-3.5 mr-1 mb-0.5" />
                                    Pedidos recibidos en SERES por EDI que <strong>no se han volcado en JDE</strong>. Revisar si se han creado manualmente.
                                </p>
                            )}
                            {activeTab === 'solo_jde' && (
                                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    <AlertTriangle className="inline h-3.5 w-3.5 mr-1 mb-0.5" />
                                    Pedidos en JDE que <strong>no aparecen en SERES</strong>.
                                </p>
                            )}
                            {activeTab === 'ambos' && (
                                <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                                    <CheckCircle2 className="inline h-3.5 w-3.5 mr-1 mb-0.5" />
                                    Pedidos correctamente <strong>sincronizados</strong> en ambos sistemas.
                                </p>
                            )}
                            {activeTab === 'incidencias' && (
                                <p className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-3 py-2">
                                    <ShieldAlert className="inline h-3.5 w-3.5 mr-1 mb-0.5" />
                                    Pedidos JDE con <strong>estado distinto de Procesado (Y)</strong>: M (duplicado), N (sin procesar) o E (error). Requieren revisión.
                                </p>
                            )}
                        </div>

                        {/* Tabla */}
                        <div className="p-4">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-gray-200 hover:bg-transparent">
                                        <TableHead className="font-bold text-gray-700">Referencia</TableHead>
                                        <TableHead className="font-bold text-gray-700">Fecha</TableHead>
                                        {activeTab !== 'solo_seres' && (
                                            <>
                                                <TableHead className="font-bold text-gray-700">Nº Destino</TableHead>
                                                <TableHead className="font-bold text-gray-700">Desc. Destino</TableHead>
                                                <TableHead className="font-bold text-gray-700">Cliente</TableHead>
                                                <TableHead className="font-bold text-gray-700">Nº Comprador</TableHead>
                                                <TableHead className="font-bold text-gray-700">Desc. Comprador</TableHead>
                                                <TableHead className="font-bold text-gray-700 text-center">Estado JDE</TableHead>
                                                <TableHead className="font-bold text-gray-700">Descripción</TableHead>
                                            </>
                                        )}
                                        {activeTab === 'solo_seres' && (
                                            <>
                                                <TableHead className="font-bold text-gray-700">Cliente</TableHead>
                                                <TableHead className="font-bold text-gray-700">Tipo</TableHead>
                                            </>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tabData[activeTab].length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-10 text-gray-500 font-medium">
                                                No hay registros en esta categoría.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        tabData[activeTab].map((p, i) => (
                                            <TableRow key={i} className="hover:bg-slate-50 border-gray-100">
                                                <TableCell className="font-mono text-sm font-semibold text-gray-800">{p.referencia}</TableCell>
                                                <TableCell className="text-gray-600 text-sm">
                                                    {formatFecha(p.fecha)}
                                                    {p.hora && <span className="ml-1.5 text-xs text-gray-400">{p.hora}</span>}
                                                </TableCell>
                                                {activeTab !== 'solo_seres' && (
                                                    <>
                                                        <TableCell className="font-mono text-sm text-gray-700">{p.shanNum ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-gray-600">{p.shanDesc ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-gray-600">{p.shanMlnm ?? '-'}</TableCell>
                                                        <TableCell className="font-mono text-sm text-gray-700">{p.urabNum ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-gray-600">{p.urabDesc ?? '-'}</TableCell>
                                                        <TableCell className="text-center">
                                                            <span
                                                                className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md border ${estadoBadgeClasses(p.estado)}`}
                                                                title={estadoLabel(p.estado, statusDescriptions)}
                                                            >
                                                                {p.estado || '?'}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell className="text-sm text-gray-600 max-w-[260px]">
                                                            {estadoLabel(p.estado, statusDescriptions)}
                                                        </TableCell>
                                                    </>
                                                )}
                                                {activeTab === 'solo_seres' && (
                                                    <>
                                                        <TableCell className="text-sm text-gray-800">
                                                            {p.clienteCodigo && (
                                                                <span className="text-xs text-gray-400 font-mono mr-1.5">{p.clienteCodigo}</span>
                                                            )}
                                                            {p.clienteNombre || '-'}
                                                        </TableCell>
                                                        <TableCell className="text-gray-500 text-xs">{p.tipo}</TableCell>
                                                    </>
                                                )}
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                )}

                {/* Estado inicial */}
                {!result && !loading && !error && (
                    <div className="text-center py-16 text-gray-400">
                        <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Selecciona el periodo y pulsa <strong className="text-gray-500">Comparar</strong></p>
                    </div>
                )}

            </div>
        </main>
    )
}
