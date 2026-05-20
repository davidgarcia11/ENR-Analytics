"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Search, Loader2, Download, X,
  ChevronDown, ChevronRight, Package, CheckCircle2, Clock, AlertCircle
} from "lucide-react"
import Navbar from "@/components/Navbar"
import Image from "next/image"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"
import React from "react"

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
  totalOrdered: number
  totalAssigned: number
  totalPending: number
  uom: string
  progress: number
  lots: LotDetail[]
}

interface Order {
  orderNumber: number
  loadDate: string
  deliveryDate: string
  plant: string
  plantName: string
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

export default function PreparacionPedidos() {
  const router = useRouter()

  // Auth
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)

  // Data
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<Summary>({ totalOrders: 0, completados: 0, enProgreso: 0, pendientes: 0 })
  const [loading, setLoading] = useState(false)

  // Filters
  const todayStr = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  const [filters, setFilters] = useState({ plant: 'all', startDate: todayStr, endDate: todayStr, deliveryStartDate: '', deliveryEndDate: '' })
  const [showStatus, setShowStatus] = useState({ pendiente: true, en_progreso: true, completado: true })

  // Plants
  const [plants, setPlants] = useState<{ id: string; description: string }[]>([])

  // Expand/collapse
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set())
  const [expandedArticles, setExpandedArticles] = useState<Set<string>>(new Set())

  // Init
  useEffect(() => {
    checkSession()
    fetchPlants()
    fetchData()
  }, [])

  const fetchPlants = async () => {
    try {
      const res = await fetch('/api/plants')
      if (res.ok) setPlants(await res.json())
    } catch { /* Oracle no disponible */ }
  }

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const user = await res.json()
        if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return }
        setSessionUser(user)
      }
    } catch { /* no logueado */ }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.plant !== 'all') params.append('plant', filters.plant)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.deliveryStartDate) params.append('deliveryStartDate', filters.deliveryStartDate)
      if (filters.deliveryEndDate) params.append('deliveryEndDate', filters.deliveryEndDate)

      const res = await fetch(`/api/orders?${params.toString()}`)
      const json = await res.json()

      if (json.error) {
        console.error('API error:', json.error)
        setOrders([])
        setSummary({ totalOrders: 0, completados: 0, enProgreso: 0, pendientes: 0 })
        return
      }

      const statusOrder: Record<string, number> = { pendiente: 0, en_progreso: 1, completado: 2 }
      const sorted = (json.orders || []).sort((a: Order, b: Order) => statusOrder[a.status] - statusOrder[b.status])
      setOrders(sorted)
      setSummary(json.summary || { totalOrders: 0, completados: 0, enProgreso: 0, pendientes: 0 })
    } catch (error) {
      console.error("Error cargando pedidos", error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    setExpandedOrders(new Set())
    setExpandedArticles(new Set())
    fetchData()
  }

  const filteredOrders = orders.filter(o => showStatus[o.status])

  const clearFilters = () => {
    setFilters({ plant: 'all', startDate: todayStr, endDate: todayStr, deliveryStartDate: '', deliveryEndDate: '' })
    setExpandedOrders(new Set())
    setExpandedArticles(new Set())
  }

  const toggleArticle = (orderNumber: number, itemNumber: string) => {
    const key = `${orderNumber}-${itemNumber}`
    setExpandedArticles(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpand = (orderNumber: number) => {
    setExpandedOrders(prev => {
      const next = new Set(prev)
      if (next.has(orderNumber)) next.delete(orderNumber)
      else next.add(orderNumber)
      return next
    })
  }

  const exportToExcel = () => {
    const rows = filteredOrders.flatMap(order =>
      order.articles.flatMap(article =>
        article.lots.map(lot => ({
          'Pedido': order.orderNumber,
          'Fecha Carga': order.loadDate ? new Date(order.loadDate).toLocaleDateString('es-ES') : '',
          'Fecha Entrega': order.deliveryDate ? new Date(order.deliveryDate).toLocaleDateString('es-ES') : '',
          'Planta': order.plantName,
          'Articulo': article.itemNumber,
          'Descripcion': article.description,
          'Linea': lot.lineNumber,
          'Cant. Pedida': lot.qtyOrdered,
          'Lote/Palet': lot.lot || '—',
          'Asignado': lot.assigned ? 'SÍ' : 'NO',
          'Total Pedido Art.': article.totalOrdered,
          'Total Asignado Art.': article.totalAssigned,
          'Total Pendiente Art.': article.totalPending,
          '% Progreso Art.': article.progress / 100,
          'UM': article.uom,
          'Estado': order.status === 'completado' ? 'COMPLETADO' : order.status === 'en_progreso' ? 'EN PROGRESO' : 'PENDIENTE',
        }))
      )
    )
    const ws = XLSX.utils.json_to_sheet(rows)

    // Formato porcentaje en columna % Progreso Art. (columna L, índice 12)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 13 })]
      if (cell) cell.z = '0.00%'
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Preparacion Pedidos")
    XLSX.writeFile(wb, `Preparacion_Pedidos_${filters.startDate}_${filters.endDate}.xlsx`)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- BARRA DE NAVEGACIÓN --- */}
        <Navbar currentPanel="pedidos" user={sessionUser} onLogout={logout} />

        {/* --- TÍTULO --- */}
        <div>
          <h1 className="text-2xl font-black text-gray-900">Preparación de Pedidos</h1>
          <p className="text-sm text-gray-500 mt-1">Progreso de asignación de palets a pedidos de venta</p>
        </div>

        {/* --- FILTROS --- */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-4" style={{ borderTop: '3px solid #D30B15' }}>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Fechas y Planta</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Fecha Carga Inicio</label>
                <Input
                  type="date"
                  value={filters.startDate}
                  onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                  className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Fecha Carga Fin</label>
                <Input
                  type="date"
                  value={filters.endDate}
                  onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                  className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Fecha Entrega Inicio</label>
                <Input
                  type="date"
                  value={filters.deliveryStartDate}
                  onChange={e => setFilters({ ...filters, deliveryStartDate: e.target.value })}
                  className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Fecha Entrega Fin</label>
                <Input
                  type="date"
                  value={filters.deliveryEndDate}
                  onChange={e => setFilters({ ...filters, deliveryEndDate: e.target.value })}
                  className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Planta</label>
                <select
                  value={filters.plant}
                  onChange={e => setFilters({ ...filters, plant: e.target.value })}
                  className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium focus:border-slate-500 focus:outline-none"
                >
                  <option value="all">Todas</option>
                  {plants.map(p => (
                    <option key={p.id} value={p.id}>{p.description}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-4">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Mostrar:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showStatus.pendiente} onChange={e => setShowStatus({ ...showStatus, pendiente: e.target.checked })} className="rounded border-gray-300 text-gray-500 focus:ring-gray-400 h-3.5 w-3.5" />
                <span className="text-xs font-semibold text-gray-500">Pendientes</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showStatus.en_progreso} onChange={e => setShowStatus({ ...showStatus, en_progreso: e.target.checked })} className="rounded border-amber-300 text-amber-500 focus:ring-amber-400 h-3.5 w-3.5" />
                <span className="text-xs font-semibold text-amber-600">En Progreso</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showStatus.completado} onChange={e => setShowStatus({ ...showStatus, completado: e.target.checked })} className="rounded border-green-300 text-green-500 focus:ring-green-400 h-3.5 w-3.5" />
                <span className="text-xs font-semibold text-green-600">Completados</span>
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Button
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
                disabled={filteredOrders.length === 0}
                className="border-green-600 text-green-700 hover:bg-green-50"
              >
                <Download className="mr-2 h-4 w-4" />
                Excel
              </Button>
              <Button
                onClick={clearFilters}
                variant="outline"
                className="border-gray-400 text-gray-600 hover:bg-gray-50"
              >
                <X className="mr-2 h-4 w-4" />
                Limpiar
              </Button>
            </div>
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
              <div className="text-2xl font-black text-gray-900">{summary.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Pedidos en el rango</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Completados</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-green-600">{summary.completados}</div>
              <p className="text-xs text-gray-500 font-medium">100% asignado</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">En Progreso</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-amber-600">{summary.enProgreso}</div>
              <p className="text-xs text-gray-500 font-medium">Parcialmente asignado</p>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Pendientes</CardTitle>
              <AlertCircle className="h-4 w-4 text-gray-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-400">{summary.pendientes}</div>
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
                  <TableHead className="font-bold text-gray-700">Pedido</TableHead>
                  <TableHead className="font-bold text-gray-700">Fecha Carga</TableHead>
                  <TableHead className="font-bold text-gray-700">Fecha Entrega</TableHead>
                  <TableHead className="font-bold text-gray-700">Planta</TableHead>
                  <TableHead className="font-bold text-gray-700">Artículos</TableHead>
                  <TableHead className="font-bold text-gray-700 w-[200px]">Progreso</TableHead>
                  <TableHead className="font-bold text-gray-700">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map(order => (
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
                      <TableCell className="font-bold text-gray-900">{order.orderNumber}</TableCell>
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
                                : order.overallProgress > 0 ? 'bg-amber-500'
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

                    {/* Detalle expandido - Nivel 1: Artículos agrupados */}
                    {expandedOrders.has(order.orderNumber) && (
                      <TableRow className="bg-gray-50/80 hover:bg-gray-50/80">
                        <TableCell colSpan={8} className="p-0">
                          <div className="px-8 py-4">
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
                                                  : article.progress > 0 ? 'bg-blue-500'
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
                                        <tr key={lotIdx} className={`border-b border-gray-50 ${lot.assigned ? 'bg-green-50/40' : 'bg-white/60'}`}>
                                          <td></td>
                                          <td className="py-1.5 px-2 pl-6 font-mono text-[11px] text-gray-400">Línea {lot.lineNumber}</td>
                                          <td></td>
                                          <td className="py-1.5 px-2 text-right text-[11px] text-gray-600">{lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</td>
                                          <td className={`py-1.5 px-2 text-right text-[11px] ${lot.assigned ? 'text-green-600 font-semibold' : 'text-gray-400'}`}>
                                            {lot.assigned ? lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                                          </td>
                                          <td className={`py-1.5 px-2 text-right text-[11px] ${!lot.assigned ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                                            {!lot.assigned ? lot.qtyOrdered.toLocaleString('es-ES', { minimumFractionDigits: 2 }) : '—'}
                                          </td>
                                          <td></td>
                                          <td className="py-1.5 px-2 text-center text-[11px] text-gray-400 font-mono">{lot.lot || '—'}</td>
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
                    <TableCell colSpan={8} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {!loading && filteredOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-gray-500 font-medium">
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
