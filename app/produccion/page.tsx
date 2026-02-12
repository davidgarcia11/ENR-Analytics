"use client" // Indica que este componente se ejecuta en el navegador del usuario (cliente), no en el servidor

import { useState, useEffect, useMemo } from "react" // Hooks de React para manejar estado y efectos secundarios
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
import { Search, Loader2, Factory, Calendar, Download, ChevronDown, ChevronsDown } from "lucide-react"
import * as XLSX from 'xlsx'; // Librería 'xlsx' para generar archivos Excel
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"

// Función principal del componente Dashboard
export default function Dashboard() {
  // --- ESTADOS (Variables que, al cambiar, actualizan la pantalla) ---
  const [data, setData] = useState<any[]>([]) // Almacena la lista de datos de producción
  const [loading, setLoading] = useState(false) // Indica si se están cargando datos (para mostrar spinners)
  const [page, setPage] = useState(1); // Página actual para la paginación
  const [hasMore, setHasMore] = useState(true); // Indica si hay más datos para cargar

  // Fecha de hoy en formato YYYY-MM-DD para inicializar filtros
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Estado para los filtros de búsqueda (inicializado con la fecha de hoy)
  const [filters, setFilters] = useState({
    plant: "all",
    subLine: "all",
    startDate: todayStr,
    endDate: todayStr,
  })

  // Estado para el filtro de artículos (multi-select)
  const [selectedArticles, setSelectedArticles] = useState<string[]>([])
  const [availableArticles, setAvailableArticles] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Tipo Proceso OF (IMPRP6)
  const [selectedPrp6, setSelectedPrp6] = useState<string[]>([])
  const [availablePrp6, setAvailablePrp6] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Formato (IMPRP6 con DRRT='S3')
  const [selectedSrp3, setSelectedSrp3] = useState<string[]>([])
  const [availableSrp3, setAvailableSrp3] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Sabor (IMSRP5 con DRRT='S5')
  const [selectedSrp5, setSelectedSrp5] = useState<string[]>([])
  const [availableSrp5, setAvailableSrp5] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Familia (IMSRP2 con DRRT='S2')
  const [selectedSrp2, setSelectedSrp2] = useState<string[]>([])
  const [availableSrp2, setAvailableSrp2] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Categoría (IMSRP1 con DRRT='S1')
  const [selectedSrp1, setSelectedSrp1] = useState<string[]>([])
  const [availableSrp1, setAvailableSrp1] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Marca (IMSRP4 con DRRT='S4')
  const [selectedSrp4, setSelectedSrp4] = useState<string[]>([])
  const [availableSrp4, setAvailableSrp4] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Líneas de producción (F30006/F0006 → F4111.ILMCUZ)
  const [selectedProdLines, setSelectedProdLines] = useState<string[]>([])
  const [availableProdLines, setAvailableProdLines] = useState<{ id: string; description: string }[]>([])

  // Estado para las métricas (totales y resúmenes)
  // Nota: Actualmente se calculan sobre los datos cargados en pantalla, no sobre el total de la base de datos
  const [metrics, setMetrics] = useState({
    totalQtyUN: 0, // Cantidad total en Unidades
    totalQtyKG: 0, // Cantidad total en Kilos
    totalOrders: 0, // Número total de órdenes
    byPlant: {} as Record<string, number> // Desglose por planta
  })

  // --- EFECTOS (Lógica que se ejecuta automáticamente) ---

  // Carga inicial: filtros de categoría, líneas de producción y datos del día
  useEffect(() => {
    fetch('/api/categories?field=prp6')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailablePrp6(data); })
      .catch(console.error);

    fetch('/api/categories?field=srp3')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableSrp3(data); })
      .catch(console.error);

    fetch('/api/categories?field=srp5')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableSrp5(data); })
      .catch(console.error);

    fetch('/api/categories?field=srp2')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableSrp2(data); })
      .catch(console.error);

    fetch('/api/categories?field=srp1')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableSrp1(data); })
      .catch(console.error);

    fetch('/api/categories?field=srp4')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableSrp4(data); })
      .catch(console.error);

    fetch('/api/production-lines')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableProdLines(data); })
      .catch(console.error);

    // Carga inicial con la fecha de hoy (ya está en el estado)
    fetchData(1, true);
  }, [])

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

  // Función para cargar todos los resultados sin paginación
  const loadAll = () => {
    setPage(1);
    setData([]);
    fetchData(1, true, true);
  };

  // Función asíncrona principal para pedir datos al servidor (API)
  const fetchData = async (pageNum: number, isNewSearch: boolean, allRecords = false) => {
    setLoading(true) // Activamos spinner de carga
    try {
      // Construimos los parámetros de la URL (?plant=X&page=Y...)
      const params = new URLSearchParams()
      if (filters.plant !== 'all') params.append('plant', filters.plant)
      if (filters.subLine !== 'all') params.append('subLine', filters.subLine)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)
      selectedArticles.forEach(a => params.append('article', a))
      selectedPrp6.forEach(v => params.append('prp6', v))
      selectedSrp3.forEach(v => params.append('srp3', v))
      selectedSrp5.forEach(v => params.append('srp5', v))
      selectedSrp2.forEach(v => params.append('srp2', v))
      selectedSrp1.forEach(v => params.append('srp1', v))
      selectedSrp4.forEach(v => params.append('srp4', v))
      selectedProdLines.forEach(v => params.append('prodLine', v))

      params.append('page', pageNum.toString());
      params.append('limit', allRecords ? '0' : '150');

      // Hacemos la petición a nuestra API interna
      const res = await fetch(`/api/production?${params.toString()}`)
      const json = await res.json() // Convertimos respuesta a JSON

      // La API devuelve { data: [...], sqlRowCount: N }
      const items = json.data ?? json; // Compatibilidad: si es array directo, lo usamos tal cual
      const sqlRowCount = json.sqlRowCount ?? (Array.isArray(json) ? json.length : items.length);

      if (Array.isArray(items)) {
        // Usamos sqlRowCount (filas SQL antes de procesar) para determinar si hay más páginas
        // Esto evita el falso negativo cuando la agrupación reduce el conteo por debajo de 150
        if (allRecords || sqlRowCount < 150) setHasMore(false);
        else setHasMore(true);

        // Si es nueva búsqueda, reemplazamos datos. Si no, añadimos al final (...data, ...json)
        const newData = isNewSearch ? items : [...data, ...items];
        setData(newData)

        // Extraer artículos únicos de los datos para el multi-select
        const articleMap = new Map<string, { id: string; description: string }>();
        if (isNewSearch) {
          // En nueva búsqueda, construimos la lista desde cero con los nuevos datos
          newData.forEach((item: any) => {
            if (item.article && item.description)
              articleMap.set(String(item.article).trim(), { id: String(item.article).trim(), description: item.description });
          });
          setAvailableArticles(Array.from(articleMap.values()));
        } else {
          // En "cargar más", acumulamos los nuevos artículos a los ya existentes
          setAvailableArticles(prev => {
            prev.forEach(a => articleMap.set(a.id, a));
            newData.slice(-items.length).forEach((item: any) => {
              if (item.article && item.description)
                articleMap.set(String(item.article).trim(), { id: String(item.article).trim(), description: item.description });
            });
            return Array.from(articleMap.values());
          });
        }

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

  // Agrupa los datos por artículo + fecha + línea + unidad para mostrar en tabla
  const displayData = useMemo(() => {
    const groupMap = new Map<string, any>();
    data.forEach(item => {
      const key = `${item.article}-${item.productionDateRaw}-${item.subLineCode}-${item.unit}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { ...item, quantity: 0 });
      }
      groupMap.get(key).quantity += item.quantity || 0;
    });
    return Array.from(groupMap.values());
  }, [data]);

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
            {/* Filtro: Artículo (multi-select, se popula con los resultados cargados) */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Artículo</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableArticles}
                  selected={selectedArticles}
                  onChange={setSelectedArticles}
                />
              </div>
            </div>

            {/* Filtro: Tipo Proceso OF (IMPRP6) */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Tipo Proceso OF</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availablePrp6}
                  selected={selectedPrp6}
                  onChange={setSelectedPrp6}
                  label="Tipo Proceso"
                />
              </div>
            </div>

            {/* Filtro: Formato (IMPRP6 con DRRT='S3') */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Formato</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableSrp3}
                  selected={selectedSrp3}
                  onChange={setSelectedSrp3}
                  label="Formato"
                />
              </div>
            </div>

            {/* Filtro: Sabor (IMSRP5 con DRRT='S5') */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Sabor</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableSrp5}
                  selected={selectedSrp5}
                  onChange={setSelectedSrp5}
                  label="Sabor"
                />
              </div>
            </div>

            {/* Filtro: Familia (IMSRP2 con DRRT='S2') */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Familia</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableSrp2}
                  selected={selectedSrp2}
                  onChange={setSelectedSrp2}
                  label="Familia"
                />
              </div>
            </div>

            {/* Filtro: Categoría (IMSRP1 con DRRT='S1') */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Categoría</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableSrp1}
                  selected={selectedSrp1}
                  onChange={setSelectedSrp1}
                  label="Categoría"
                />
              </div>
            </div>

            {/* Filtro: Marca (IMSRP4 con DRRT='S4') */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Marca</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableSrp4}
                  selected={selectedSrp4}
                  onChange={setSelectedSrp4}
                  label="Marca"
                />
              </div>
            </div>

            {/* Filtro: Líneas de producción (F30006/F0006 → F4111.ILMCUZ) */}
            <div className="grid gap-1.5">
              <label className="text-xs font-semibold text-gray-700">Línea Producción</label>
              <div className="w-[200px]">
                <ArticleMultiSelect
                  articles={availableProdLines}
                  selected={selectedProdLines}
                  onChange={setSelectedProdLines}
                  label="Línea Producción"
                  showId={false}
                />
              </div>
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
                  <TableHead className="font-bold text-gray-700">Artículo</TableHead>
                  <TableHead className="font-bold text-gray-700">Descripción</TableHead>
                  <TableHead className="font-bold text-gray-700">Planta / Línea</TableHead>
                  <TableHead className="text-right font-bold text-gray-700">Cantidad</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">UM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Mapeamos los datos agrupados por artículo para crear filas */}
                {displayData.map((row, i) => (
                  <TableRow key={i} className="hover:bg-slate-50 border-gray-100">
                    <TableCell className="font-medium text-gray-900">
                      {row.date ? new Date(row.date).toLocaleDateString() : row.productionDateRaw}
                    </TableCell>
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
                    <TableCell colSpan={6} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {/* Mensaje si no hay datos */}
                {!loading && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-gray-500 font-medium">
                      No se encontraron datos para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {/* Botones de Paginación */}
            {hasMore && data.length > 0 && !loading && (
              <div className="mt-6 flex justify-center gap-3">
                <Button onClick={loadMore} variant="ghost" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100">
                  <ChevronDown className="mr-2 h-4 w-4" />
                  Cargar más (150)
                </Button>
                <Button onClick={loadAll} variant="outline" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 border-slate-300">
                  <ChevronsDown className="mr-2 h-4 w-4" />
                  Cargar todos
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
