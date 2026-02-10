"use client" // Indica que este componente se ejecuta en el navegador del usuario (cliente), no en el servidor

import { useState, useEffect } from "react" // Hooks de React para manejar estado y efectos secundarios
// Importamos componentes de interfaz de usuario (UI) reutilizables desde nuestra carpeta local
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
// Iconos de la librería lucide-react para dar estilo visual
import { Search, Loader2, Factory, Calendar, Download, ChevronDown } from "lucide-react"
import * as XLSX from 'xlsx'; // Librería 'xlsx' para generar archivos Excel

// Función principal del componente Dashboard
export default function Dashboard() {
  // --- ESTADOS (Variables que, al cambiar, actualizan la pantalla) ---
  const [data, setData] = useState<any[]>([]) // Almacena la lista de datos de producción
  const [loading, setLoading] = useState(false) // Indica si se están cargando datos (para mostrar spinners)
  const [page, setPage] = useState(1); // Página actual para la paginación
  const [hasMore, setHasMore] = useState(true); // Indica si hay más datos para cargar

  // Estado para los filtros de búsqueda
  const [filters, setFilters] = useState({
    plant: "all",
    subLine: "all",
    article: "",
    startDate: "",
    endDate: "",
  })

  // Estado para las métricas (totales y resúmenes)
  // Nota: Actualmente se calculan sobre los datos cargados en pantalla, no sobre el total de la base de datos
  const [metrics, setMetrics] = useState({
    totalQtyUN: 0, // Cantidad total en Unidades
    totalQtyKG: 0, // Cantidad total en Kilos
    totalOrders: 0, // Número total de órdenes
    byPlant: {} as Record<string, number> // Desglose por planta
  })

  // --- EFECTOS (Lógica que se ejecuta automáticamente) ---

  // useEffect se ejecuta una vez al montar el componente (array vacío [])
  // Aquí establecemos las fechas por defecto al día de hoy
  useEffect(() => {
    const today = new Date();

    // Construimos la fecha en formato YYYY-MM-DD local
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Meses van de 0-11, sumamos 1
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    // Actualizamos el estado de filtros con la fecha de hoy
    setFilters(prev => ({
      ...prev,
      startDate: todayStr,
      endDate: todayStr
    }))
    // Nota: dependencias vacías [] significa que solo corre al inicio
  }, [])

  // useEffect para recargar datos cuando cambian ciertos filtros
  // En este caso, solo cuando cambia la fecha de inicio se dispara la búsqueda automática
  useEffect(() => {
    if (filters.startDate) fetchData(1, true); // Página 1, nueva búsqueda
  }, [filters.startDate]) // Array de dependencias: se ejecuta cuando filters.startDate cambia

  // --- FUNCIONES AUXILIARES ---

  // Esta función se llama al pulsar el botón "Filtrar"
  const applyFilters = () => {
    setPage(1); // Reseteamos a la página 1
    setData([]); // Limpiamos los datos actuales
    fetchData(1, true); // Llamamos a la API indicando que es una nueva búsqueda
  }

  // Maneja el cambio en el desplegable de Plantas
  const handlePlantChange = (plantValue: string) => {
    let newSubLine = 'all';

    // Lógica para preseleccionar la sub-línea según la planta
    if (plantValue === '10100') newSubLine = '1';      // Aguilar siempre es 1
    else if (plantValue === '10200') newSubLine = '2'; // Corella siempre es 2
    // Funes (10300) se deja en 'all' para que el usuario elija entre 3, 4, 5

    // Actualizamos el estado de filtros
    setFilters(prev => ({
      ...prev,
      plant: plantValue,
      subLine: newSubLine
    }));
  };

  // Función para cargar la siguiente página de datos (Botón "Cargar más")
  const loadMore = () => {
    const nextPage = page + 1; // Calculamos siguiente página
    setPage(nextPage); // Actualizamos estado
    fetchData(nextPage, false); // Llamamos a API, false indica que añada datos a los existentes (no borrar)
  };

  // Función asíncrona principal para pedir datos al servidor (API)
  const fetchData = async (pageNum: number, isNewSearch: boolean) => {
    setLoading(true) // Activamos spinner de carga
    try {
      // Construimos los parámetros de la URL (?plant=X&page=Y...)
      const params = new URLSearchParams()
      if (filters.plant !== 'all') params.append('plant', filters.plant)
      if (filters.subLine !== 'all') params.append('subLine', filters.subLine)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      if (filters.article) params.append('article', filters.article)

      params.append('page', pageNum.toString());
      params.append('limit', '150'); // Pedimos 150 registros por página

      // Hacemos la petición a nuestra API interna
      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json() // Convertimos respuesta a JSON

      if (Array.isArray(json)) {
        // Si llegaron menos de 150 registros, asumimos que no hay más páginas
        if (json.length < 150) setHasMore(false);
        else setHasMore(true);

        // Si es nueva búsqueda, reemplazamos datos. Si no, añadimos al final (...data, ...json)
        const newData = isNewSearch ? json : [...data, ...json];
        setData(newData)

        // --- CÁLCULO DE MÉTRICAS (Lado del Cliente) ---
        // Recorremos los datos cargados para sumar totales
        let qtyUN = 0;
        let qtyKG = 0;
        const plants: Record<string, number> = {};
        const orders = new Set(); // Set evita duplicados de órdenes

        newData.forEach(item => {
          const u = item.unit ? item.unit.toUpperCase() : '';
          // Sumamos según unidad de medida
          if (u === 'UN') qtyUN += item.quantity || 0;
          else if (u === 'KG') qtyKG += item.quantity || 0;

          orders.add(item.order); // Guardamos orden única

          const pName = item.subLine || 'Desconocido';
          // Acumulamos cantidad por planta
          plants[pName] = (plants[pName] || 0) + (item.quantity || 0);
        });

        // Actualizamos estado de métricas
        setMetrics({
          totalQtyUN: qtyUN,
          totalQtyKG: qtyKG,
          totalOrders: orders.size,
          byPlant: plants
        })
      }
    } catch (error) {
      console.error("Error cargando datos", error) // Si falla, mostramos error en consola
    } finally {
      setLoading(false) // Desactivamos spinner, pase lo que pase
    }
  }

  // Función para exportar los datos visibles a Excel
  const exportToExcel = () => {
    // Mapeamos los datos a un formato limpio para el Excel
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

    // Creamos libro y hoja
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produccion");

    // Descargamos el archivo
    XLSX.writeFile(wb, `Produccion_${filters.startDate}_${filters.endDate}.xlsx`);
  };

  // --- RENDERIZADO (HTML) ---
  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- CABECERA Y FILTROS --- */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard de Producción</h1>
            <p className="text-gray-600">Visualización de órdenes de fabricación y cantidades.</p>
          </div>

          {/* Panel de Filtros */}
          <div className="flex flex-wrap items-end gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            {/* Filtro: Artículo */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Artículo</label>
              <Input
                type="text"
                maxLength={10}
                placeholder="Art. (10 dígitos)"
                value={filters.article}
                onChange={(e) => {
                  // Reemplaza cualquier caracter que NO sea número (\D) por vacío
                  const val = e.target.value.replace(/\D/g, '');
                  setFilters({ ...filters, article: val })
                }}
                className="w-[140px] border-gray-300 focus:border-slate-500 font-medium"
              />
            </div>

            {/* Filtro: Fechas */}
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

            {/* Filtro: Planta */}
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

            {/* Filtro: Sub-planta (Sólo visible para Funes o Todas) */}
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

            {/* Botones de Acción */}
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

        {/* --- TARJETAS DE MÉTRICAS (KPIs) --- */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Tarjeta 1: Cantidad Total */}
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

          {/* Tarjeta 2: Órdenes */}
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

          {/* Tarjeta 3: Planta con mayor volumen */}
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Top Planta</CardTitle>
              <Factory className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">
                {/* Ordena las plantas por cantidad y coge la primera */}
                {Object.entries(metrics.byPlant).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'}
              </div>
              <p className="text-xs text-gray-500 font-medium">Mayor volumen (cargado)</p>
            </CardContent>
          </Card>
        </div>

        {/* --- TABLA DE DATOS --- */}
        <Card className="col-span-4 border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-gray-800">Detalle de Producción</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                {/* Cabecera de la tabla */}
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
                {/* Mapeamos los datos para crear filas */}
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

                {/* Spinner si está cargando */}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {/* Mensaje si no hay datos */}
                {!loading && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-gray-500 font-medium">
                      No se encontraron datos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Botón Cargar Más */}
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
