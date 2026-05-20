"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, ArrowLeft, FileText, ChevronLeft, ChevronRight, LogIn, Clock, Search, Users, Zap, BarChart3, Download, Trophy } from "lucide-react"
import Image from "next/image"
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface LogEntry {
  id: number
  user_id: number | null
  username: string
  source: string
  filters: string
  result_count: number
  execution_time_ms: number
  created_at: string
}

const SOURCE_LABELS: Record<string, string> = {
  'produccion': 'Producción',
  'pedidos': 'Preparación Pedidos',
  'login': 'Login',
  'caducados_obsoletos': 'Palets Caducados',
  'comparativa_seres': 'Comparativa SERES',
}

// Umbral en ms para marcar consultas lentas
const SLOW_QUERY_MS = 3000

interface Stats {
  totalQueries: number
  avgTime: number
  maxTime: number
  minTime: number
  avgResults: number
}

interface DailyStat {
  day: string
  queries: number
  avgTime: number
  uniqueUsers: number
}

interface TopUser {
  username: string
  queries: number
}

const PLANT_NAMES: Record<string, string> = {
  '10100': 'Aguilar',
  '10200': 'Corella',
  '10300': 'Funes',
  'all': 'Todas',
}

function isLoginLog(filtersJson: string): boolean {
  try {
    const f = JSON.parse(filtersJson)
    return f.action === 'login'
  } catch {
    return false
  }
}

function summarizeFilters(filtersJson: string): string {
  try {
    const f = JSON.parse(filtersJson)

    if (f.action === 'login') return 'Inicio de sesión'

    const parts: string[] = []

    const plantName = f.plant ? (PLANT_NAMES[f.plant] || f.plant) : null
    if (plantName) parts.push(plantName)

    if (f.startDate && f.endDate) {
      if (f.startDate === f.endDate) {
        parts.push(new Date(f.startDate).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }))
      } else {
        parts.push(
          new Date(f.startDate).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) +
          ' - ' +
          new Date(f.endDate).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
        )
      }
    }

    const categoryFields = ['articles', 'prp6s', 'srp3s', 'srp5s', 'srp2s', 'srp1s', 'srp4s', 'ze03s', 'prodLines']
    let catCount = 0
    for (const key of categoryFields) {
      if (f[key] && Array.isArray(f[key]) && f[key].length > 0) catCount += f[key].length
    }
    if (catCount > 0) parts.push(`${catCount} filtro${catCount > 1 ? 's' : ''}`)

    // Filtros de caducados
    if (f.type && f.type !== 'todos') parts.push(f.type.charAt(0).toUpperCase() + f.type.slice(1))
    if (f.location && f.location !== 'all') parts.push(f.location === '__blank__' ? 'Genérica' : f.location)

    return parts.length > 0 ? parts.join(' · ') : 'Sin filtros'
  } catch {
    return 'Sin filtros'
  }
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function LogsPage() {
  const router = useRouter()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats>({ totalQueries: 0, avgTime: 0, maxTime: 0, minTime: 0, avgResults: 0 })
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([])
  const [topUsers, setTopUsers] = useState<TopUser[]>([])
  const [invitadoCount, setInvitadoCount] = useState(0)
  const [showChart, setShowChart] = useState(false)
  const [chartDays, setChartDays] = useState(14)

  // Filtros
  const [filterUsername, setFilterUsername] = useState("")
  const [filterStartDate, setFilterStartDate] = useState("")
  const [filterEndDate, setFilterEndDate] = useState("")
  const [filterSource, setFilterSource] = useState("")
  const [usernames, setUsernames] = useState<string[]>([])
  const [filterTrigger, setFilterTrigger] = useState(0)

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (authorized) loadLogs()
  }, [page, authorized, filterTrigger, chartDays])

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      if (data.role !== "admin") { router.push("/produccion"); return }
      setAuthorized(true)
    } catch {
      router.push("/login")
    }
  }

  const loadLogs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), chartDays: String(chartDays) })
      if (filterUsername) params.set('username', filterUsername)
      if (filterStartDate) params.set('startDate', filterStartDate)
      if (filterEndDate) params.set('endDate', filterEndDate)
      if (filterSource) params.set('source', filterSource)

      const res = await fetch(`/api/admin/logs?${params}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs)
        setTotalPages(data.totalPages)
        setTotal(data.total)
        setUsernames(data.usernames)
        setStats(data.stats)
        setDailyStats(data.dailyStats || [])
        setTopUsers(data.topUsers || [])
        setInvitadoCount(data.invitadoCount || 0)
      }
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    setPage(1)
    setFilterTrigger(t => t + 1)
  }

  const clearFilters = () => {
    setFilterUsername("")
    setFilterStartDate("")
    setFilterEndDate("")
    setFilterSource("")
    setPage(1)
    setFilterTrigger(t => t + 1)
  }

  const exportToExcel = () => {
    const rows = logs.map(log => ({
      'Fecha': new Date(log.created_at + 'Z').toLocaleString('es-ES'),
      'Usuario': log.username,
      'Panel': SOURCE_LABELS[log.source] || log.source,
      'Filtros': summarizeFilters(log.filters),
      'Resultados': isLoginLog(log.filters) ? '' : log.result_count,
      'Tiempo (ms)': isLoginLog(log.filters) ? '' : log.execution_time_ms,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 18 }, { wch: 35 }, { wch: 12 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Logs")
    XLSX.writeFile(wb, `Logs_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  // Preparar datos del gráfico
  const chartData = dailyStats.map(d => ({
    day: new Date(d.day).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }),
    'Consultas': d.queries,
    'Tiempo medio (s)': Number((d.avgTime / 1000).toFixed(1)),
    'Usuarios': d.uniqueUsers,
  }))

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Logs de Consultas</h1>
              <p className="text-sm text-gray-500">{total} registros totales</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/admin")} className="text-gray-600">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Admin
            </Button>
            <Button variant="outline" onClick={() => router.push("/produccion")} className="text-gray-600">
              Dashboard
            </Button>
          </div>
        </div>

        {/* Tarjetas de estadísticas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Search className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase">Consultas</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{stats.totalQueries.toLocaleString('es-ES')}</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase">Tiempo medio</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{formatTime(stats.avgTime)}</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase">Tiempo máximo</span>
              </div>
              <p className={`text-2xl font-bold ${stats.maxTime > SLOW_QUERY_MS ? 'text-red-600' : 'text-gray-800'}`}>
                {formatTime(stats.maxTime)}
              </p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-semibold text-gray-500 uppercase">Resultados medio</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{Math.round(stats.avgResults).toLocaleString('es-ES')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Ranking de usuarios + botón gráfico */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Ranking usuarios */}
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Trophy className="h-4 w-4" style={{ color: '#D30B15' }} />
                Usuarios más activos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topUsers.length === 0 ? (
                <p className="text-sm text-gray-400">Sin datos</p>
              ) : (
                <div className="space-y-2">
                  {topUsers.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 w-4">{i + 1}.</span>
                        <span className="text-sm font-medium text-gray-700">{u.username}</span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">{u.queries.toLocaleString('es-ES')}</span>
                    </div>
                  ))}
                  {invitadoCount > 0 && (
                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100">
                      <span className="text-xs text-gray-400 italic">Anónimas (Invitado)</span>
                      <span className="text-xs font-medium text-gray-400">{invitadoCount.toLocaleString('es-ES')}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gráfico toggle + selector días */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant={showChart ? "default" : "outline"}
                onClick={() => setShowChart(!showChart)}
                className={showChart ? "text-white font-semibold flex-1" : "text-gray-600 flex-1"}
                style={showChart ? { backgroundColor: '#D30B15' } : {}}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                {showChart ? 'Ocultar gráfico' : 'Ver gráfico'}
              </Button>
              <Button variant="outline" onClick={exportToExcel} disabled={logs.length === 0} className="text-gray-600">
                <Download className="mr-2 h-4 w-4" />
                Excel
              </Button>
            </div>
            {showChart && (
              <div className="flex gap-2">
                {[7, 14, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setChartDays(d)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${chartDays === d ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                    style={chartDays === d ? { backgroundColor: '#D30B15', borderColor: '#D30B15' } : {}}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Gráfico de actividad */}
        {showChart && (
          <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader>
              <CardTitle className="text-sm font-bold text-gray-700">Actividad últimos {chartDays} días</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No hay datos suficientes para mostrar el gráfico</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#6b7280' }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#6b7280' }} unit="s" />
                    <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, border: '1px solid #e5e7eb' }} labelStyle={{ fontWeight: 600 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="left" type="monotone" dataKey="Consultas" stroke="#D30B15" strokeWidth={2} dot={{ r: 4, fill: '#D30B15' }} />
                    <Line yAxisId="right" type="monotone" dataKey="Tiempo medio (s)" stroke="#6b7280" strokeWidth={2} dot={{ r: 4, fill: '#6b7280' }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {/* Filtros */}
        <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Panel</label>
                <select
                  value={filterSource}
                  onChange={e => setFilterSource(e.target.value)}
                  className="flex h-9 w-[170px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Todos</option>
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Usuario</label>
                <select
                  value={filterUsername}
                  onChange={e => setFilterUsername(e.target.value)}
                  className="flex h-9 w-[160px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Todos</option>
                  {usernames.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Desde</label>
                <input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)}
                  className="flex h-9 w-[150px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Hasta</label>
                <input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)}
                  className="flex h-9 w-[150px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm" />
              </div>
              <Button onClick={applyFilters} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }}>
                Filtrar
              </Button>
              <Button variant="outline" onClick={clearFilters} className="text-gray-500">
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla de logs */}
        <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <FileText className="h-4 w-4" style={{ color: '#D30B15' }} />
              Historial de Consultas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No hay consultas registradas</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 hover:bg-transparent">
                      <TableHead className="font-bold text-gray-700">Fecha / Hora</TableHead>
                      <TableHead className="font-bold text-gray-700">Usuario</TableHead>
                      <TableHead className="font-bold text-gray-700">Panel</TableHead>
                      <TableHead className="font-bold text-gray-700">Filtros</TableHead>
                      <TableHead className="font-bold text-gray-700 text-right">Resultados</TableHead>
                      <TableHead className="font-bold text-gray-700 text-right">Tiempo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => {
                      const isLogin = isLoginLog(log.filters)
                      const isSlow = !isLogin && log.execution_time_ms > SLOW_QUERY_MS
                      return (
                        <TableRow key={log.id} className={`border-gray-100 ${isLogin ? 'bg-blue-50/50 hover:bg-blue-50' : isSlow ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-slate-50'}`}>
                          <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                            {new Date(log.created_at + 'Z').toLocaleString('es-ES', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </TableCell>
                          <TableCell>
                            <span className={`text-sm font-medium ${log.user_id ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                              {log.username}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isLogin ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                              {SOURCE_LABELS[log.source] || log.source}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600 max-w-[300px] truncate" title={isLogin ? 'Inicio de sesión' : log.filters}>
                            <span className="flex items-center gap-1.5">
                              {isLogin && <LogIn className="h-3.5 w-3.5 text-blue-500" />}
                              {summarizeFilters(log.filters)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium text-gray-700">
                            {isLogin ? '—' : (log.result_count?.toLocaleString('es-ES') ?? '—')}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-semibold ${isSlow ? 'text-red-600' : 'text-gray-500'}`}>
                            {isLogin ? '—' : (log.execution_time_ms != null ? formatTime(log.execution_time_ms) : '—')}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                {/* Paginación */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500">
                      Página {page} de {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                        Anterior
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                        Siguiente
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
