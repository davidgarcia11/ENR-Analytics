"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, Loader2, Factory, Calendar } from "lucide-react"

export default function Dashboard() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    plant: "all",

    startDate: "",
    endDate: "",
  })

  const [metrics, setMetrics] = useState({
    totalQty: 0,
    totalOrders: 0,
    byPlant: {} as Record<string, number>
  })

  // Set default dates to current month on init
  useEffect(() => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    setFilters(prev => ({
      ...prev,
      startDate: firstDay.toISOString().split('T')[0],
      endDate: lastDay.toISOString().split('T')[0]
    }))
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.plant !== 'all') params.append('plant', filters.plant)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json()

      if (Array.isArray(json)) {
        setData(json)
        // Calculate Metrics
        let qty = 0;
        const plants: Record<string, number> = {};
        const orders = new Set();

        json.forEach(item => {
          qty += item.quantity || 0;
          orders.add(item.order);
          const pName = item.subLine || 'Desconocido';
          plants[pName] = (plants[pName] || 0) + (item.quantity || 0);
        });

        setMetrics({
          totalQty: qty,
          totalOrders: orders.size,
          byPlant: plants
        })
      }
    } catch (error) {
      console.error("Error loading data", error)
    } finally {
      setLoading(false)
    }
  }

  // Auto fetch on mount after date set? Or manual?
  // Let's do manual or effect on filters?
  // User might prefer manual to avoid spamming if changing dates.
  // But let's load initial data once dates are set in the first effect?
  // We'll use a separate effect for initial load or just let user click.
  // Better: separate load effect dependent on `filters.startDate` becoming available.
  /*
  useEffect(() => {
    if (filters.startDate && filters.endDate) {
       fetchData()
    }
  }, [filters.startDate, filters.endDate]) // This might trigger too often while typing.
  */
  // I'll stick to manual "Filtrar" button + Initial Load.

  useEffect(() => {
    // Initial load when component mounts?
    // Maybe wait for user interaction to avoid heavy query on start, 
    // but dashboard usually shows something.
    // I'll skip auto-load and let user choose filters, or load with defaults.
    // Let's load with defaults.
    if (filters.startDate) fetchData();
  }, [filters.startDate]) // Only run once when start date is set by the first effect.

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard de Producción</h1>
            <p className="text-gray-600">Visualización de órdenes de fabricación y cantidades.</p>
          </div>
          <div className="flex flex-wrap items-end gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Fecha Inicio</label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Fecha Fin</label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-[150px] border-gray-300 focus:border-slate-500 font-medium"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Planta</label>
              <select
                className="flex h-9 w-[150px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus:border-slate-500 font-medium"
                value={filters.plant}
                onChange={(e) => setFilters({ ...filters, plant: e.target.value })}
              >
                <option value="all">Todas</option>
                <option value="10100">Aguilar</option>
                <option value="10200">Corella</option>
                <option value="10300">Funes</option>
              </select>
            </div>

            <Button onClick={fetchData} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white font-semibold">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Filtrar
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Cantidad Total</CardTitle>
              <Factory className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{metrics.totalQty.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</div>
              <p className="text-xs text-gray-500 font-medium">Unidades fabricadas en el periodo</p>
            </CardContent>
          </Card>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Órdenes</CardTitle>
              <Calendar className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{metrics.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Total de órdenes procesadas</p>
            </CardContent>
          </Card>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Top Planta</CardTitle>
              <Factory className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">
                {Object.entries(metrics.byPlant).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
              </div>
              <p className="text-xs text-gray-500 font-medium">Mayor volumen de producción</p>
            </CardContent>
          </Card>
        </div>

        {/* Breakdown */}
        <Card className="col-span-4 border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-800">Detalle de Producción</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 hover:bg-transparent">
                  <TableHead className="font-bold text-gray-700">Fecha</TableHead>
                  <TableHead className="font-bold text-gray-700">Orden</TableHead>
                  <TableHead className="font-bold text-gray-700">Artículo</TableHead>
                  <TableHead className="font-bold text-gray-700">Descripción</TableHead>
                  <TableHead className="font-bold text-gray-700">Planta / Línea</TableHead>
                  <TableHead className="text-right font-bold text-gray-700">Cantidad</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">UM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-gray-500 font-medium">
                      No se encontraron datos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((row, i) => (
                    <TableRow key={i} className="hover:bg-slate-50 border-gray-100">
                      <TableCell className="font-medium text-gray-900">
                        {row.date ? new Date(row.date).toLocaleDateString() : row.productionDateRaw}
                      </TableCell>
                      <TableCell className="text-gray-700">{row.order}</TableCell>
                      <TableCell className="text-gray-700 font-mono text-xs bg-gray-100 px-2 py-1 rounded w-fit">{row.article}</TableCell>
                      <TableCell className="text-gray-600 uppercase text-xs font-semibold">{row.description}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-800 text-xs">{row.subLine}</span>
                          <span className="text-[10px] text-gray-400 font-mono">{row.subLineCode} · {row.plantCode}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-slate-900">
                        {row.quantity?.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-center text-xs text-gray-500 font-mono">
                        {row.unit}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
