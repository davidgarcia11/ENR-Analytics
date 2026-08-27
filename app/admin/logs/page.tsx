"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { Tabs } from "@/components/ui/tabs"
import { AppShell } from "@/components/AppShell"
import {
  FileText, ChevronLeft, ChevronRight, LogIn, Clock, Search, Users, Zap, BarChart3, Download,
  Trophy, Inbox, ScanBarcode,
} from "lucide-react"
import * as XLSX from 'xlsx'
import { DatePicker } from "@/components/DatePicker"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

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

interface ScanConfirmation {
  id: number
  user_id: number | null
  username: string
  sscc: string
  articulo: string | null
  estado: 'correcto' | 'aviso' | 'no_encontrado' | 'sin_fecha' | 'otra_subplanta'
  mensajes: string // JSON array
  created_at: string
}

const ESTADO_BADGE: Record<ScanConfirmation['estado'], { label: string; variant: 'success' | 'destructive' | 'warning' }> = {
  correcto: { label: 'Correcto', variant: 'success' },
  aviso: { label: 'Aviso', variant: 'destructive' },
  no_encontrado: { label: 'No encontrado', variant: 'destructive' },
  sin_fecha: { label: 'Sin fecha', variant: 'warning' },
  otra_subplanta: { label: 'Otra sub-planta', variant: 'warning' },
}

function parseMensajes(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : [String(v)]
  } catch {
    return [json]
  }
}

const SOURCE_LABELS: Record<string, string> = {
  'produccion': 'Producción',
  'pedidos': 'Preparación Pedidos',
  'login': 'Login',
  'caducados_obsoletos': 'Palets Caducados',
  'comparativa_seres': 'Comparativa SERES',
  'consulta_stock_pda': 'Consulta Stock PDA',
  'compras': 'Compras',
  'mrp': 'Explosión de compras',
  'coste_a1': 'Coste A1',
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
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
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

  // ─── Pestaña "Confirmaciones PDA" (pop-up de /consulta-stock-pda) ───────────
  const [activeTab, setActiveTab] = useState<'consultas' | 'confirmaciones'>('consultas')
  const [confirmations, setConfirmations] = useState<ScanConfirmation[]>([])
  const [loadingConfirmations, setLoadingConfirmations] = useState(true)
  const [confirmPage, setConfirmPage] = useState(1)
  const [confirmTotalPages, setConfirmTotalPages] = useState(1)
  const [confirmTotal, setConfirmTotal] = useState(0)
  const [confirmUsernames, setConfirmUsernames] = useState<string[]>([])
  const [filterConfirmUsername, setFilterConfirmUsername] = useState("")
  const [filterConfirmEstado, setFilterConfirmEstado] = useState("")
  const [filterConfirmSscc, setFilterConfirmSscc] = useState("")
  const [filterConfirmStartDate, setFilterConfirmStartDate] = useState("")
  const [filterConfirmEndDate, setFilterConfirmEndDate] = useState("")
  const [confirmFilterTrigger, setConfirmFilterTrigger] = useState(0)

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (authorized) loadLogs()
  }, [page, authorized, filterTrigger, chartDays])

  useEffect(() => {
    if (authorized && activeTab === 'confirmaciones') loadConfirmations()
  }, [authorized, activeTab, confirmPage, confirmFilterTrigger])

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      if (data.role !== "admin") { router.push("/produccion"); return }
      setSessionUser(data)
      setAuthorized(true)
    } catch {
      router.push("/login")
    }
  }

  // Cierre de sesión para la Navbar del AppShell
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
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

  const loadConfirmations = async () => {
    setLoadingConfirmations(true)
    try {
      const params = new URLSearchParams({ page: String(confirmPage) })
      if (filterConfirmUsername) params.set('username', filterConfirmUsername)
      if (filterConfirmEstado) params.set('estado', filterConfirmEstado)
      if (filterConfirmSscc) params.set('sscc', filterConfirmSscc)
      if (filterConfirmStartDate) params.set('startDate', filterConfirmStartDate)
      if (filterConfirmEndDate) params.set('endDate', filterConfirmEndDate)

      const res = await fetch(`/api/admin/scan-confirmations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setConfirmations(data.confirmations)
        setConfirmTotalPages(data.totalPages)
        setConfirmTotal(data.total)
        setConfirmUsernames(data.usernames)
      }
    } finally {
      setLoadingConfirmations(false)
    }
  }

  const applyConfirmFilters = () => {
    setConfirmPage(1)
    setConfirmFilterTrigger(t => t + 1)
  }

  const clearConfirmFilters = () => {
    setFilterConfirmUsername("")
    setFilterConfirmEstado("")
    setFilterConfirmSscc("")
    setFilterConfirmStartDate("")
    setFilterConfirmEndDate("")
    setConfirmPage(1)
    setConfirmFilterTrigger(t => t + 1)
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner label="Comprobando permisos..." />
      </div>
    )
  }

  return (
    <AppShell
      navbar={{
        user: sessionUser,
        onLogout: logout,
      }}
      title="Logs de consultas"
      description="Registro de consultas ejecutadas por panel y usuario"
    >
        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as 'consultas' | 'confirmaciones')}
          tabs={[
            { value: 'consultas', label: 'Consultas' },
            { value: 'confirmaciones', label: 'Confirmaciones PDA', count: confirmTotal || undefined },
          ]}
        />

        {activeTab === 'consultas' && (
        <>
        {/* Tarjetas de estadísticas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card accent className="overflow-hidden">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Consultas</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{stats.totalQueries.toLocaleString('es-ES')}</p>
            </CardContent>
          </Card>
          <Card accent className="overflow-hidden">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Tiempo medio</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatTime(stats.avgTime)}</p>
            </CardContent>
          </Card>
          <Card accent className="overflow-hidden">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Tiempo máximo</span>
              </div>
              <p className={`text-2xl font-bold ${stats.maxTime > SLOW_QUERY_MS ? 'text-destructive' : 'text-foreground'}`}>
                {formatTime(stats.maxTime)}
              </p>
            </CardContent>
          </Card>
          <Card accent className="overflow-hidden">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-semibold text-muted-foreground uppercase">Resultados medio</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{Math.round(stats.avgResults).toLocaleString('es-ES')}</p>
            </CardContent>
          </Card>
        </div>

        {/* Ranking de usuarios + botón gráfico */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Ranking usuarios */}
          <Card accent>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
                Usuarios más activos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              ) : (
                <div className="space-y-2">
                  {topUsers.map((u, i) => (
                    <div key={u.username} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground w-4">{i + 1}.</span>
                        <span className="text-sm font-medium text-secondary-foreground">{u.username}</span>
                      </div>
                      <span className="text-sm font-bold text-foreground">{u.queries.toLocaleString('es-ES')}</span>
                    </div>
                  ))}
                  {invitadoCount > 0 && (
                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground italic">Anónimas (Invitado)</span>
                      <span className="text-xs font-medium text-muted-foreground">{invitadoCount.toLocaleString('es-ES')}</span>
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
                className={showChart ? "font-semibold flex-1" : "flex-1"}
              >
                <BarChart3 className="mr-2 h-4 w-4" aria-hidden="true" />
                {showChart ? 'Ocultar gráfico' : 'Ver gráfico'}
              </Button>
              <Button variant="outline" onClick={exportToExcel} disabled={logs.length === 0}>
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Excel
              </Button>
            </div>
            {showChart && (
              <div className="flex gap-2">
                {[7, 14, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setChartDays(d)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${chartDays === d ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-secondary-foreground border-input hover:bg-muted/50'}`}
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
          <Card accent>
            <CardHeader>
              <CardTitle className="text-sm font-bold text-secondary-foreground">Actividad últimos {chartDays} días</CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No hay datos suficientes para mostrar el gráfico</p>
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
        <Card accent>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Panel</label>
                <select
                  value={filterSource}
                  onChange={e => setFilterSource(e.target.value)}
                  className="flex h-9 w-[170px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todos</option>
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Usuario</label>
                <select
                  value={filterUsername}
                  onChange={e => setFilterUsername(e.target.value)}
                  className="flex h-9 w-[160px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todos</option>
                  {usernames.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Desde</label>
                <DatePicker value={filterStartDate} onChange={setFilterStartDate} className="w-[150px]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Hasta</label>
                <DatePicker value={filterEndDate} onChange={setFilterEndDate} className="w-[150px]" />
              </div>
              <Button onClick={applyFilters} className="font-semibold">
                Filtrar
              </Button>
              <Button variant="outline" onClick={clearFilters}>
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla de logs */}
        <Card accent>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
              Historial de Consultas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Spinner label="Cargando logs..." className="py-10" />
            ) : logs.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Sin registros"
                description="No hay consultas registradas para los filtros seleccionados"
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="font-bold text-secondary-foreground">Fecha / Hora</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Usuario</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Panel</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Filtros</TableHead>
                      <TableHead className="font-bold text-secondary-foreground text-right">Resultados</TableHead>
                      <TableHead className="font-bold text-secondary-foreground text-right">Tiempo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map(log => {
                      const isLogin = isLoginLog(log.filters)
                      const isSlow = !isLogin && log.execution_time_ms > SLOW_QUERY_MS
                      return (
                        <TableRow key={log.id} className={`border-border ${isLogin ? 'bg-blue-50/50 hover:bg-blue-50' : isSlow ? 'bg-red-50/50 hover:bg-red-50' : 'hover:bg-muted/50'}`}>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at + 'Z').toLocaleString('es-ES', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </TableCell>
                          <TableCell>
                            <span className={`text-sm font-medium ${log.user_id ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                              {log.username}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${isLogin ? 'bg-blue-100 text-blue-700' : 'bg-muted text-secondary-foreground'}`}>
                              {SOURCE_LABELS[log.source] || log.source}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate" title={isLogin ? 'Inicio de sesión' : log.filters}>
                            <span className="flex items-center gap-1.5">
                              {isLogin && <LogIn className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />}
                              {summarizeFilters(log.filters)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium text-secondary-foreground">
                            {isLogin ? '—' : (log.result_count?.toLocaleString('es-ES') ?? '—')}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-semibold ${isSlow ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {isLogin ? '—' : (log.execution_time_ms != null ? formatTime(log.execution_time_ms) : '—')}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                {/* Paginación */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Página {page} de {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Anterior
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                        Siguiente
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        </>
        )}

        {activeTab === 'confirmaciones' && (
        <>
        {/* Filtros */}
        <Card accent>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Usuario</label>
                <select
                  value={filterConfirmUsername}
                  onChange={e => setFilterConfirmUsername(e.target.value)}
                  className="flex h-9 w-[160px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todos</option>
                  {confirmUsernames.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Resultado</label>
                <select
                  value={filterConfirmEstado}
                  onChange={e => setFilterConfirmEstado(e.target.value)}
                  className="flex h-9 w-[150px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todos</option>
                  {Object.entries(ESTADO_BADGE).map(([key, v]) => (
                    <option key={key} value={key}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">SSCC</label>
                <input
                  value={filterConfirmSscc}
                  onChange={e => setFilterConfirmSscc(e.target.value)}
                  placeholder="Buscar SSCC..."
                  className="flex h-9 w-[170px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Desde</label>
                <DatePicker value={filterConfirmStartDate} onChange={setFilterConfirmStartDate} className="w-[150px]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-secondary-foreground">Hasta</label>
                <DatePicker value={filterConfirmEndDate} onChange={setFilterConfirmEndDate} className="w-[150px]" />
              </div>
              <Button onClick={applyConfirmFilters} className="font-semibold">
                Filtrar
              </Button>
              <Button variant="outline" onClick={clearConfirmFilters}>
                Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla de confirmaciones */}
        <Card accent>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
              <ScanBarcode className="h-4 w-4 text-primary" aria-hidden="true" />
              Confirmaciones del pop-up de Consulta Stock PDA
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingConfirmations ? (
              <Spinner label="Cargando confirmaciones..." className="py-10" />
            ) : confirmations.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Sin registros"
                description="No hay confirmaciones registradas para los filtros seleccionados"
              />
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className="font-bold text-secondary-foreground">Fecha / Hora</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Usuario</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">SSCC</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Artículo</TableHead>
                      <TableHead className="font-bold text-secondary-foreground">Resultado aceptado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {confirmations.map(c => (
                      <TableRow key={c.id} className="border-border hover:bg-muted/50">
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(c.created_at + 'Z').toLocaleString('es-ES', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell>
                          <span className={`text-sm font-medium ${c.user_id ? 'text-foreground' : 'text-muted-foreground italic'}`}>
                            {c.username}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-mono text-secondary-foreground">{c.sscc}</TableCell>
                        <TableCell className="text-sm text-secondary-foreground">{c.articulo || '—'}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <Badge variant={ESTADO_BADGE[c.estado].variant}>{ESTADO_BADGE[c.estado].label}</Badge>
                            {parseMensajes(c.mensajes).map((m, i) => (
                              <div key={i} className="text-xs text-muted-foreground">{m}</div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Paginación */}
                {confirmTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                    <p className="text-sm text-muted-foreground">
                      Página {confirmPage} de {confirmTotalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={confirmPage <= 1} onClick={() => setConfirmPage(p => p - 1)}>
                        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                        Anterior
                      </Button>
                      <Button variant="outline" size="sm" disabled={confirmPage >= confirmTotalPages} onClick={() => setConfirmPage(p => p + 1)}>
                        Siguiente
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        </>
        )}
    </AppShell>
  )
}
