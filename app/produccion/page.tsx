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
import { Search, Loader2, Factory, Calendar, Download, ChevronDown, ChevronsDown, X, User, LogOut, Save, BookmarkCheck, Trash2, Settings, FileText } from "lucide-react"
import Image from "next/image"
import * as XLSX from 'xlsx'; // Librería 'xlsx' para generar archivos Excel
import { ArticleMultiSelect } from "@/components/ArticleMultiSelect"
import { useRouter } from "next/navigation"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface Preset { id: number; name: string; filters: string; created_at: string }

// Función principal del componente Dashboard
export default function Dashboard() {
  const router = useRouter()

  // --- ESTADOS DE AUTENTICACIÓN Y PRESETS ---
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [presets, setPresets] = useState<Preset[]>([])
  const [showPresets, setShowPresets] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [savingPreset, setSavingPreset] = useState(false)

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

  // Estado para el filtro de Formato (AAZE03 de F554101 con DRRT='B3')
  const [selectedZe03, setSelectedZe03] = useState<string[]>([])
  const [availableZe03, setAvailableZe03] = useState<{ id: string; description: string }[]>([])

  // Estado para el filtro de Líneas de producción (F30006/F0006 → F4111.ILMCUZ)
  const [selectedProdLines, setSelectedProdLines] = useState<string[]>([])
  const [availableProdLines, setAvailableProdLines] = useState<{ id: string; description: string }[]>([])

  // Estado para las métricas (totales y resúmenes)
  // Nota: Actualmente se calculan sobre los datos cargados en pantalla, no sobre el total de la base de datos
  const [metrics, setMetrics] = useState({
    totalQtyUN: 0, // Cantidad total en Unidades
    totalQtyKG: 0, // Cantidad total en Kilos
    totalOrders: 0, // Número total de órdenes
    byPlant: {} as Record<string, number>, // Desglose por planta
    totalMerma: 0, // Merma total (valor absoluto)
    totalProduced: 0, // Producción total (para calcular % merma global)
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

    fetch('/api/categories?field=ze03')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableZe03(data); })
      .catch(console.error);

    fetch('/api/production-lines')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAvailableProdLines(data); })
      .catch(console.error);

    // Carga inicial con la fecha de hoy (ya está en el estado)
    fetchData(1, true);

    // Comprobar sesión (silencioso, no bloquea)
    checkSession();
  }, [])

  // --- FUNCIONES AUXILIARES ---

  // Esta función se llama al pulsar el botón "Filtrar"
  const applyFilters = () => {
    setPage(1); // Reseteamos a la página 1
    setData([]); // Limpiamos los datos actuales
    fetchData(1, true, true); // Llamamos a la API sin paginación (todos los registros)
  }

  // Limpia todos los filtros y vuelve a los valores por defecto
  const clearFilters = () => {
    setFilters({ plant: "all", subLine: "all", startDate: todayStr, endDate: todayStr });
    setSelectedArticles([]);
    setSelectedPrp6([]);
    setSelectedSrp3([]);
    setSelectedSrp5([]);
    setSelectedSrp2([]);
    setSelectedSrp1([]);
    setSelectedSrp4([]);
    setSelectedZe03([]);
    setSelectedProdLines([]);
  }

  // --- FUNCIONES DE AUTENTICACIÓN Y PRESETS ---
  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const user = await res.json()
        if (user.mustChangePassword) {
          router.push('/cambiar-contrasena')
          return
        }
        setSessionUser(user)
        loadPresets()
      }
    } catch { /* no logueado, ok */ }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSessionUser(null)
    setPresets([])
    setShowPresets(false)
  }

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/presets')
      if (res.ok) setPresets(await res.json())
    } catch { /* silencioso */ }
  }

  const savePreset = async (nameOverride?: string) => {
    const name = nameOverride || presetName
    if (!name.trim()) return
    setSavingPreset(true)
    try {
      const filtersData = {
        plant: filters.plant,
        subLine: filters.subLine,
        startDate: filters.startDate,
        endDate: filters.endDate,
        selectedArticles,
        selectedPrp6,
        selectedSrp3,
        selectedSrp5,
        selectedSrp2,
        selectedSrp1,
        selectedSrp4,
        selectedZe03,
        selectedProdLines,
      }
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filters: filtersData }),
      })
      if (res.ok) {
        setPresetName('')
        loadPresets()
      } else {
        const data = await res.json()
        alert(data.error || 'Error al guardar')
      }
    } finally {
      setSavingPreset(false)
    }
  }

  const loadPreset = (preset: Preset) => {
    const f = JSON.parse(preset.filters)
    setFilters({
      plant: f.plant || 'all',
      subLine: f.subLine || 'all',
      startDate: f.startDate || todayStr,
      endDate: f.endDate || todayStr,
    })
    setSelectedArticles(f.selectedArticles || [])
    setSelectedPrp6(f.selectedPrp6 || [])
    setSelectedSrp3(f.selectedSrp3 || [])
    setSelectedSrp5(f.selectedSrp5 || [])
    setSelectedSrp2(f.selectedSrp2 || [])
    setSelectedSrp1(f.selectedSrp1 || [])
    setSelectedSrp4(f.selectedSrp4 || [])
    setSelectedZe03(f.selectedZe03 || [])
    setSelectedProdLines(f.selectedProdLines || [])
    setShowPresets(false)
  }

  const deletePreset = async (id: number) => {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    loadPresets()
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
      selectedZe03.forEach(v => params.append('ze03', v))
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
        let totalMerma = 0;
        let totalProduced = 0;
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

          // Acumulamos merma y producción totales
          totalMerma += Math.abs(item.merma || 0);
          totalProduced += item.quantity || 0;
        });

        // Actualizamos estado de métricas
        setMetrics({
          totalQtyUN: qtyUN,
          totalQtyKG: qtyKG,
          totalOrders: orders.size,
          byPlant: plants,
          totalMerma,
          totalProduced,
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
    // Usamos displayData (ya agrupado y con merma) ordenado por % merma descendente
    const sorted = [...displayData].sort((a, b) => (b.mermaPercent || 0) - (a.mermaPercent || 0));

    const excelRows = sorted.map(item => ({
      Fecha: item.date ? new Date(item.date).toLocaleDateString() : item.productionDateRaw,
      Articulo: item.article,
      Descripcion: item.description,
      Planta: item.subLine,
      Cantidad: Math.round((item.quantity || 0) * 100) / 100,
      Merma: Math.round(Math.abs(item.merma || 0) * 100) / 100,
      '% Merma': (item.mermaPercent || 0) / 100, // Como decimal para formato porcentaje Excel
      Unidad: item.unit
    }));

    const ws = XLSX.utils.json_to_sheet(excelRows);

    // Formato porcentaje en columna G (% Merma), empezando en fila 2 (fila 1 = cabecera)
    const mermaColIdx = 6; // Columna G (0-indexed)
    for (let r = 0; r < excelRows.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: mermaColIdx });
      if (ws[cellRef]) ws[cellRef].z = '0.00%';
    }

    // Formato condicional: colorear top 25% de % merma con fondo rojo
    // xlsx no soporta formato condicional nativo, así que coloreamos directamente las celdas del top 25%
    const mermaValues = sorted.map(r => r.mermaPercent || 0).filter(v => v > 0);
    const p75Idx = Math.floor(mermaValues.length * 0.75);
    const p75Threshold = mermaValues.sort((a, b) => a - b)[p75Idx] || 0;

    for (let r = 0; r < sorted.length; r++) {
      const cellRef = XLSX.utils.encode_cell({ r: r + 1, c: mermaColIdx });
      if (ws[cellRef] && (sorted[r].mermaPercent || 0) >= p75Threshold && p75Threshold > 0) {
        ws[cellRef].s = {
          fill: { fgColor: { rgb: 'FFCCCC' } },
          font: { bold: true, color: { rgb: 'CC0000' } }
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produccion");

    XLSX.writeFile(wb, `Produccion_${filters.startDate}_${filters.endDate}.xlsx`);
  };

  // Agrupa los datos por artículo + fecha + línea + unidad para mostrar en tabla
  // Calcula merma y % merma por grupo, ordena de mayor a menor % merma
  const displayData = useMemo(() => {
    const groupMap = new Map<string, any>();
    data.forEach(item => {
      const key = `${item.article}-${item.productionDateRaw}-${item.subLineCode}-${item.unit}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { ...item, quantity: 0, merma: 0 });
      }
      const g = groupMap.get(key);
      g.quantity += item.quantity || 0;
      g.merma += item.merma || 0;
    });
    return Array.from(groupMap.values()).map(item => {
      const absMerma = Math.abs(item.merma);
      const total = absMerma + item.quantity;
      const mermaPercent = total > 0
        ? Math.round((absMerma / total) * 10000) / 100
        : 0;
      return { ...item, mermaPercent };
    }).sort((a, b) => b.mermaPercent - a.mermaPercent);
  }, [data]);

  // Calcula el umbral del percentil 75 de % merma para formato condicional
  const mermaP75 = useMemo(() => {
    const values = displayData.map(r => r.mermaPercent).filter(v => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const idx = Math.floor(values.length * 0.75);
    return values[Math.min(idx, values.length - 1)];
  }, [displayData]);

  // Color del % merma: rojo fuerte si está en top 25%, naranja si > 2%, verde si bajo
  const getMermaColor = (percent: number) => {
    if (percent === 0) return 'text-gray-400';
    if (percent >= mermaP75 && mermaP75 > 0) return 'text-red-600 bg-red-50 font-black';
    if (percent >= 5) return 'text-red-500 font-bold';
    if (percent >= 2) return 'text-amber-600 font-bold';
    return 'text-green-600 font-semibold';
  };

  // --- RENDERIZADO (HTML) ---
  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-7xl space-y-8">

        {/* --- BARRA DE SESIÓN --- */}
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
          <div className="flex-1" />
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
              <button onClick={() => setShowPresets(!showPresets)} className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 flex items-center gap-1.5">
                <BookmarkCheck className="h-3.5 w-3.5" />
                Presets
              </button>
              <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            </>
          ) : (
            <a href="/login" className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300">
              <User className="h-3.5 w-3.5" />
              Iniciar sesión
            </a>
          )}
        </div>

        {/* --- PANEL DE PRESETS (solo si logueado y abierto) --- */}
        {sessionUser && showPresets && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" style={{ borderTop: '3px solid #D30B15' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <BookmarkCheck className="h-4 w-4" style={{ color: '#D30B15' }} />
                Mis Presets de Filtros
              </h3>
              <button onClick={() => setShowPresets(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Guardar preset actual */}
            <div className="flex items-center gap-2 mb-3">
              <Input
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                placeholder="Nombre del preset..."
                className="h-8 text-sm max-w-[250px]"
                onKeyDown={e => e.key === 'Enter' && savePreset()}
              />
              <Button
                onClick={() => savePreset()}
                disabled={savingPreset || !presetName.trim()}
                size="sm"
                className="text-white text-xs font-semibold h-8"
                style={{ backgroundColor: '#D30B15' }}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Guardar
              </Button>
            </div>

            {/* Lista de presets */}
            {presets.length === 0 ? (
              <p className="text-xs text-gray-400">No tienes presets guardados.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <div key={p.id} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
                    <button onClick={() => loadPreset(p)} className="font-medium text-gray-700 hover:text-gray-900">
                      {p.name}
                    </button>
                    <button onClick={() => deletePreset(p.id)} className="text-gray-300 hover:text-red-500 ml-1">
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

            {/* Sección 1: Filtros de categoría */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Categorías</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Artículo</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableArticles}
                      selected={selectedArticles}
                      onChange={setSelectedArticles}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Tipo Proceso OF</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availablePrp6}
                      selected={selectedPrp6}
                      onChange={setSelectedPrp6}
                      label="Tipo Proceso"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Formato</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableSrp3}
                      selected={selectedSrp3}
                      onChange={setSelectedSrp3}
                      label="Formato"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Sabor</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableSrp5}
                      selected={selectedSrp5}
                      onChange={setSelectedSrp5}
                      label="Sabor"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Familia</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableSrp2}
                      selected={selectedSrp2}
                      onChange={setSelectedSrp2}
                      label="Familia"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Categoría</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableSrp1}
                      selected={selectedSrp1}
                      onChange={setSelectedSrp1}
                      label="Categoría"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Marca</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableSrp4}
                      selected={selectedSrp4}
                      onChange={setSelectedSrp4}
                      label="Marca"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Gramaje</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableZe03}
                      selected={selectedZe03}
                      onChange={setSelectedZe03}
                      label="Gramaje"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Línea Producción</label>
                  <div className="w-[170px]">
                    <ArticleMultiSelect
                      articles={availableProdLines}
                      selected={selectedProdLines}
                      onChange={setSelectedProdLines}
                      label="Línea Producción"
                      showId={false}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* Sección 2: Filtros operativos */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Fechas y Planta</p>
              <div className="flex flex-wrap items-end gap-3">
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
              </div>
            </div>

            <div className="border-t border-gray-100" />

            {/* Sección 3: Acciones */}
            <div className="flex flex-wrap items-end gap-3 justify-end">
              <Button onClick={applyFilters} disabled={loading} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#b00a12')} onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#D30B15')}>
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

              {/* Presets rápidos (solo si logueado) */}
              {sessionUser && (
                <>
                  {presets.length > 0 && (
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-gray-700">Cargar preset</label>
                      <select
                        onChange={e => { const p = presets.find(p => p.id === Number(e.target.value)); if (p) loadPreset(p); e.target.value = ''; }}
                        defaultValue=""
                        className="flex h-9 w-[160px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm"
                      >
                        <option value="" disabled>Seleccionar...</option>
                        {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="border-blue-500 text-blue-600 hover:bg-blue-50"
                    onClick={() => {
                      const name = prompt('Nombre del preset:');
                      if (name && name.trim()) savePreset(name.trim());
                    }}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Guardar
                  </Button>
                </>
              )}
            </div>
          </div>

        {/* --- TARJETAS DE MÉTRICAS (KPIs) --- */}
        <div className="grid gap-4 md:grid-cols-4">
          {/* Tarjeta 1: Cantidad Total */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Cantidad Total</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
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
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Órdenes</CardTitle>
              <Calendar className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-black text-gray-900">{metrics.totalOrders}</div>
              <p className="text-xs text-gray-500 font-medium">Total de órdenes (cargadas)</p>
            </CardContent>
          </Card>

          {/* Tarjeta 3: Merma global */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Merma</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
            </CardHeader>
            <CardContent>
              {(() => {
                const total = metrics.totalMerma + metrics.totalProduced;
                const pct = total > 0 ? (metrics.totalMerma / total) * 100 : 0;
                const color = pct >= 5 ? 'text-red-600' : pct >= 2 ? 'text-amber-600' : 'text-green-600';
                return (
                  <div className="flex flex-col space-y-1">
                    <div className="flex items-baseline justify-between">
                      <div className={`text-2xl font-black ${color}`}>{pct.toFixed(2)}%</div>
                    </div>
                    <div className="text-xs text-gray-500 font-medium">
                      {metrics.totalMerma.toLocaleString('es-ES', { minimumFractionDigits: 2 })} merma / {metrics.totalProduced.toLocaleString('es-ES', { minimumFractionDigits: 2 })} producido
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Tarjeta 4: Planta con mayor volumen */}
          <Card className="border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold text-gray-700">Top Planta</CardTitle>
              <Factory className="h-4 w-4" style={{ color: '#D30B15' }} />
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
        <Card className="col-span-4 border-gray-200 shadow-sm overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
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
                  <TableHead className="text-right font-bold text-gray-700">Cantidad</TableHead>
                  <TableHead className="text-right font-bold text-gray-700">Merma</TableHead>
                  <TableHead className="text-right font-bold text-gray-700">% Merma</TableHead>
                  <TableHead className="font-bold text-gray-700 text-center">UM</TableHead>
                  <TableHead className="font-bold text-gray-700">Planta / Línea</TableHead>
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
                    <TableCell className="text-right font-bold text-slate-900">
                      {row.quantity?.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-700">
                      {Math.abs(row.merma || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={`text-right text-sm px-3 py-1 rounded ${getMermaColor(row.mermaPercent || 0)}`}>
                      {(row.mermaPercent || 0).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-center text-xs text-gray-500 font-mono">
                      {row.unit}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-800 text-xs">{row.subLine}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{row.subLineCode} · {row.plantCode}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {/* Spinner si está cargando */}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-800" />
                    </TableCell>
                  </TableRow>
                )}

                {/* Mensaje si no hay datos */}
                {!loading && data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-gray-500 font-medium">
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
