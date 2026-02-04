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
import { Search, Loader2, Factory, Calendar, Download, ChevronDown } from "lucide-react"
import * as XLSX from 'xlsx';

export default function Dashboard() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState({
    plant: "all",
    subLine: "all",
    article: "",
    startDate: "",
    endDate: "",
  })

  // Metrics need to be calculated on ALL data theoretically, 
  // currently calculated on loaded data.
  // For a "Load More" scenario, it's better if metrics come from API or strictly based on loaded keys.
  // We will keep metrics on loaded data for simplicity now.
  const [metrics, setMetrics] = useState({
    totalQtyUN: 0,
    totalQtyKG: 0,
    totalOrders: 0,
    byPlant: {} as Record<string, number>
  })

  // Set default dates to current date on init
  useEffect(() => {
    const today = new Date();
    // Adjust for timezone offset to ensure correct date string in local time
    // OR simply use split('T')[0] if UTC is fine, but for "current local day" usually we want local.
    // However, pure toISOString uses UTC.
    // Let's stick to the previous pattern but use 'today' for both.
    // To minimize timezone issues, constructing a local YYYY-MM-DD string is better.
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    setFilters(prev => ({
      ...prev,
      startDate: todayStr,
      endDate: todayStr
    }))
  }, [])

  // Reset data when filters change (except page if page change is internal, but here we likely want full reset on filter change)
  const applyFilters = () => {
    setPage(1);
    setData([]);
    fetchData(1, true);
  }

  const handlePlantChange = (plantValue: string) => {
    let newSubLine = 'all';

    // Auto-select subline based on plant
    if (plantValue === '10100') newSubLine = '1';      // Aguilar -> 1
    else if (plantValue === '10200') newSubLine = '2'; // Corella -> 2
    // Funes (10300) defaults to 'all' to let user choose 3, 4, 5

    setFilters(prev => ({
      ...prev,
      plant: plantValue,
      subLine: newSubLine
    }));
  };

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchData(nextPage, false);
  };

  const fetchData = async (pageNum: number, isNewSearch: boolean) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.plant !== 'all') params.append('plant', filters.plant)
      if (filters.subLine !== 'all') params.append('subLine', filters.subLine)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.article) params.append('article', filters.article)

      params.append('page', pageNum.toString());
      params.append('limit', '150');

      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json()

      if (Array.isArray(json)) {
        if (json.length < 150) setHasMore(false);
        else setHasMore(true);

        const newData = isNewSearch ? json : [...data, ...json];
        setData(newData)

        // Calculate Metrics (On currently loaded data for now)
        // Note: Ideally metrics should be a separate API call returning aggregations over the full dataset.
        // Re-calculating on client side with partial data is an approximation.
        let qtyUN = 0;
        let qtyKG = 0;
        const plants: Record<string, number> = {};
        const orders = new Set();

        newData.forEach(item => {
          const u = item.unit ? item.unit.toUpperCase() : '';
          if (u === 'UN') qtyUN += item.quantity || 0;
          else if (u === 'KG') qtyKG += item.quantity || 0;

          orders.add(item.order);
          const pName = item.subLine || 'Desconocido';
          plants[pName] = (plants[pName] || 0) + (item.quantity || 0);
        });

        setMetrics({
          totalQtyUN: qtyUN,
          totalQtyKG: qtyKG,
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

  useEffect(() => {
    // We can auto-fetch when subLine changes if desired, but user clicks Filter button usually.
    // Given the previous code didn't auto-fetch on plant change (only startDate), we stick to that.
    if (filters.startDate) fetchData(1, true);
  }, [filters.startDate])

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(data.map(item => ({
      Fecha: item.date ? new Date(item.date).toLocaleDateString() : item.productionDateRaw,
      Orden: item.order,
      Articulo: item.article,
      Descripcion: item.description,
      Planta: item.subLine,
      Codigo_Planta: item.plantCode,
      Cantidad: item.quantity,
      Unidad: item.unit
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produccion");
    XLSX.writeFile(wb, `Produccion_${filters.startDate}_${filters.endDate}.xlsx`);
  };

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
              <label className="text-xs font-semibold text-gray-700">Artículo</label>
              <Input
                type="text"
                maxLength={10}
                placeholder="Art. (10 dígitos)"
                value={filters.article}
                onChange={(e) => {
                  // Allow only numbers
                  const val = e.target.value.replace(/\D/g, '');
                  setFilters({ ...filters, article: val })
                }}
                className="w-[140px] border-gray-300 focus:border-slate-500 font-medium"
              />
            </div>
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
                onChange={(e) => handlePlantChange(e.target.value)}
              >
                <option value="all">Todas</option>
                <option value="10100">Aguilar</option>
                <option value="10200">Corella</option>
                <option value="10300">Funes</option>
              </select>
            </div>

            {/* Sub-line Dropdown - Only visible/enabled for relevant selections */}
            {(filters.plant === '10300' || filters.plant === 'all') && (
              <div className="grid gap-1.5 animate-in fade-in duration-300">
                <label className="text-xs font-semibold text-gray-700">Sub-planta / Línea</label>
                <select
                  className="flex h-9 w-[150px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus:border-slate-500 font-medium disabled:opacity-50"
                  value={filters.subLine}
                  onChange={(e) => setFilters({ ...filters, subLine: e.target.value })}
                  disabled={filters.plant !== '10300' && filters.plant !== 'all'}
                >
                  <option value="all">Todas</option>
                  {filters.plant === '10300' && (
                    <>
                      <option value="3">Funes 1</option>
                      <option value="4">Funes 2</option>
                      <option value="5">Funes Past.</option>
                    </>
                  )}
                </select>
              </div>
            )}

            <Button onClick={applyFilters} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white font-semibold">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Filtrar
            </Button>
            <Button onClick={exportToExcel} variant="outline" disabled={data.length === 0} className="border-green-600 text-green-700 hover:bg-green-50">
              <Download className="mr-2 h-4 w-4" />
              Excel
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
              <div className="flex flex-col space-y-1">
                <div className="flex items-baseline justify-between">
                  <div className="text-2xl font-black text-gray-900">{metrics.totalQtyUN.toLocaleString('es-ES', { minimumFractionDigits: 0 })}</div>
                  <span className="text-xs font-bold text-gray-500">UN</span>
                </div>
                {metrics.totalQtyKG > 0 && (
                  <div className="flex items-baseline justify-between border-t border-gray-100 pt-1">
                    <div className="text-lg font-bold text-gray-700">{metrics.totalQtyKG.toLocaleString('es-ES', { minimumFractionDigits: 2 })}</div>
                    <span className="text-xs font-bold text-gray-500">KG</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 font-medium mt-2">Unidades fabricadas (cargadas)</p>
            </CardContent>
          </Card>
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Órdenes</CardTitle>
              <Calendar className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{metrics.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Total de órdenes (cargadas)</p>
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
              <p className="text-xs text-gray-500 font-medium">Mayor volumen (cargado)</p>
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
                {data.map((row, i) => (
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
                ))}

                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {!loading && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-gray-500 font-medium">
                      No se encontraron datos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Load More Button */}
            {hasMore && data.length > 0 && !loading && (
              <div className="mt-6 flex justify-center">
                <Button onClick={loadMore} variant="ghost" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100">
                  <ChevronDown className="mr-2 h-4 w-4" />
                  Cargar más resultados
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
