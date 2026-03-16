"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search, Loader2, Download, X, User, LogOut, Settings, FileText, AlertTriangle, Package, Archive, MapPin, Lock } from "lucide-react"
import Image from "next/image"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface Plant { id: string; description: string }
interface PaletRow {
  articleLong: string; description: string; plantCode: string; plantName: string;
  paletLote: string; palet: string; lote: string; location: string; quantity: number;
  expiryDate: string | null; motivo: string;
}
interface Summary {
  totalPallets: number; totalQuantity: number; caducados: number; obsoletos: number; bloqueados: number; ambos: number;
}

export default function CaducadosPage() {
  const router = useRouter()

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [data, setData] = useState<PaletRow[]>([])
  const [summary, setSummary] = useState<Summary>({ totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })
  const [loading, setLoading] = useState(false)
  const [plants, setPlants] = useState<Plant[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [selectedPlant, setSelectedPlant] = useState('all')
  const [selectedLocation, setSelectedLocation] = useState('all')
  const [selectedType, setSelectedType] = useState<'todos' | 'caducados' | 'obsoletos' | 'bloqueados'>('todos')

  useEffect(() => {
    checkSession()
    fetchData()
  }, [])

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const user = await res.json()
        if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return }
        setSessionUser(user)
      }
    } catch { }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
    router.push('/login')
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedPlant !== 'all') params.append('plant', selectedPlant)
      if (selectedLocation !== 'all') params.append('location', selectedLocation)
      params.append('type', selectedType)

      const res = await fetch(`/api/caducados?${params.toString()}`)
      if (!res.ok) throw new Error('Error fetching data')
      const json = await res.json()

      setData(json.data || [])
      setSummary(json.summary || { totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })

      // Guardar ubicaciones del servidor
      if (json.locations?.length > 0) {
        setLocations(json.locations)
      }

      // Extraer plantas unicas de los datos para el dropdown
      if (json.data?.length > 0) {
        const plantMap = new Map<string, string>()
        for (const row of json.data) {
          if (row.plantCode && !plantMap.has(row.plantCode)) {
            plantMap.set(row.plantCode, row.plantName || row.plantCode)
          }
        }
        const newPlants = Array.from(plantMap.entries()).map(([id, description]) => ({ id, description })).sort((a, b) => a.id.localeCompare(b.id))
        if (newPlants.length > plants.length) setPlants(newPlants)
      }
    } catch (err) {
      console.error('Fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setSelectedPlant('all')
    setSelectedLocation('all')
    setSelectedType('todos')
    setData([])
    setSummary({ totalPallets: 0, totalQuantity: 0, caducados: 0, obsoletos: 0, bloqueados: 0, ambos: 0 })
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

  const getMotivoBadge = (motivo: string) => {
    if (motivo.includes('Caducado') && motivo.includes('+')) return 'bg-red-100 text-red-800 border border-red-300 font-bold'
    if (motivo === 'Caducado') return 'bg-red-50 text-red-700 border border-red-200 font-semibold'
    if (motivo === 'Bloqueado') return 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
    if (motivo === 'Obsoleto') return 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold'
    if (motivo.includes('+')) return 'bg-purple-50 text-purple-700 border border-purple-200 font-bold'
    return 'bg-gray-50 text-gray-700 border border-gray-200 font-semibold'
  }

  const getLocationLabel = (loc: string) => {
    if (!loc) return 'GENERICA'
    return loc
  }

  const typeButtons: { value: 'todos' | 'caducados' | 'obsoletos' | 'bloqueados'; label: string }[] = [
    { value: 'todos', label: 'Todos' },
    { value: 'caducados', label: 'Caducados' },
    { value: 'obsoletos', label: 'Obsoletos' },
    { value: 'bloqueados', label: 'Bloqueados' },
  ]

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- BARRA DE SESION --- */}
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
          <div className="flex-1" />

          <button onClick={() => router.push('/produccion')} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300">
            Produccion
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
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            </>
          ) : (
            <a href="/login" className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300">
              <User className="h-3.5 w-3.5" />
              Iniciar sesion
            </a>
          )}
        </div>

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
                      key={btn.value}
                      onClick={() => setSelectedType(btn.value)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${selectedType === btn.value
                        ? 'text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                        }`}
                      style={selectedType === btn.value ? { backgroundColor: '#D30B15' } : {}}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Planta */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Planta</label>
                <select
                  className="flex h-9 w-[180px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus:border-slate-500 font-medium"
                  value={selectedPlant}
                  onChange={(e) => setSelectedPlant(e.target.value)}
                >
                  <option value="all">Todas</option>
                  {plants.map(p => <option key={p.id} value={p.id}>{p.description}</option>)}
                </select>
              </div>

              {/* Ubicacion */}
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Ubicacion</label>
                <select
                  className="flex h-9 w-[180px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus:border-slate-500 font-medium"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                >
                  <option value="all">Todas</option>
                  <option value="__blank__">GENERICA</option>
                  {locations.filter(l => l !== '').map(l => <option key={l} value={l}>{getLocationLabel(l)}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Acciones */}
          <div className="flex flex-wrap items-end gap-3 justify-end">
            <Button onClick={fetchData} disabled={loading} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#b00a12')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#D30B15')}>
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
          </div>
        </div>

        {/* --- TARJETAS METRICAS --- */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Total Palets</CardTitle>
              <Package className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{summary.totalPallets.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Registros encontrados</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Cantidad Total</CardTitle>
              <Archive className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{summary.totalQuantity.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</div>
              <p className="text-xs text-gray-500 font-medium">Unidades en stock</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Caducados</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-red-600">{summary.caducados.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets con fecha vencida</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Obsoletos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-amber-600">{summary.obsoletos.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets con articulo obsoleto</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Bloqueados</CardTitle>
              <Lock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-blue-600">{summary.bloqueados.toLocaleString('es-ES')}</div>
              <p className="text-xs text-gray-500 font-medium">Palets bloqueados</p>
            </CardContent>
          </Card>
        </div>

        {/* --- TABLA DE DATOS --- */}
        <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-800">Palets Caducados y Obsoletos</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
