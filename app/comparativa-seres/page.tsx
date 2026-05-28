"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Search, Download, X, AlertTriangle, CheckCircle2, ArrowLeftRight } from "lucide-react"
import Navbar from "@/components/Navbar"
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
    urabNum?: number | null;
    urabDesc?: string | null;
}

interface Resumen {
    total_seres_todos: number;
    total_seres_pedidos: number;
    total_jde: number;
    solo_en_seres: number;
    solo_en_jde: number;
    en_ambos: number;
    days: number;
}

interface ComparativaResult {
    resumen: Resumen;
    solo_en_seres: Pedido[];
    solo_en_jde: Pedido[];
    en_ambos: Pedido[];
}

type Tab = 'solo_seres' | 'solo_jde' | 'ambos'

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
    }

    const exportToExcel = () => {
        if (!result) return
        const wb = XLSX.utils.book_new()
        const toRows = (arr: Pedido[]) => arr.map(p => ({
            Referencia: p.referencia,
            Fecha: formatFecha(p.fecha),
            ...(p.tipo ? { Tipo: p.tipo } : {}),
        }))
        const soloSeresRows = result.solo_en_seres.map(p => ({
            Referencia: p.referencia,
            Fecha: formatFecha(p.fecha),
            'Cód. Cliente': p.clienteCodigo ?? '',
            Cliente: p.clienteNombre ?? '',
            Tipo: p.tipo ?? '',
        }))
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(soloSeresRows), 'Solo en SERES')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(result.solo_en_jde)), 'Solo en JDE')
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(toRows(result.en_ambos)), 'En ambos')
        XLSX.writeFile(wb, `Comparativa_SERES_JDE_${new Date().toISOString().split('T')[0]}.xlsx`)
    }

    const tabData: Record<Tab, Pedido[]> = result
        ? { solo_seres: result.solo_en_seres, solo_jde: result.solo_en_jde, ambos: result.en_ambos }
        : { solo_seres: [], solo_jde: [], ambos: [] }

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
                <Navbar currentPanel="comparativa" user={sessionUser} onLogout={logout} />

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
                    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
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
                                <div className="text-2xl font-black text-amber-600">{result.resumen.solo_en_seres.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">no están en JDE</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: '3px solid #ef4444' }} onClick={() => setActiveTab('solo_jde')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">Solo en JDE</CardTitle>
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-red-600">{result.resumen.solo_en_jde.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">no están en SERES</p>
                            </CardContent>
                        </Card>

                        <Card className="border-gray-200 shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow" style={{ borderTop: '3px solid #22c55e' }} onClick={() => setActiveTab('ambos')}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-bold text-gray-700">En ambos</CardTitle>
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black text-green-600">{result.resumen.en_ambos.toLocaleString('es-ES')}</div>
                                <p className="text-xs text-gray-500 font-medium">sincronizados</p>
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
                                    {result.resumen.solo_en_seres}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('solo_jde')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'solo_jde' ? 'border-red-500 text-red-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                Solo en JDE
                                <span className="ml-2 bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {result.resumen.solo_en_jde}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('ambos')}
                                className={`px-4 py-2 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${activeTab === 'ambos' ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                            >
                                En ambos
                                <span className="ml-2 bg-green-100 text-green-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
                                    {result.resumen.en_ambos}
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
                                                <TableHead className="font-bold text-gray-700">Nº Comprador</TableHead>
                                                <TableHead className="font-bold text-gray-700">Desc. Comprador</TableHead>
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
                                                        <TableCell className="font-mono text-sm text-gray-700">{p.urabNum ?? '-'}</TableCell>
                                                        <TableCell className="text-sm text-gray-600">{p.urabDesc ?? '-'}</TableCell>
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
