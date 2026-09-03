import { Factory, Package, AlertTriangle, ArrowLeftRight, ScanBarcode, ShoppingCart, Boxes, FlaskConical } from "lucide-react"

// Fuente única de la verdad de los paneles reales de la app (no incluye /admin,
// que se gestiona aparte por rol). La usan Navbar, la portada (/), el login
// (redirect tras autenticar), admin (SCREEN_KEYS, gestión de permisos) y el
// seed de la tabla `screens` en lib/sqlite.ts.
//
// ponytail: antes esta misma lista vivía copiada en esos mismos sitios. Al
// añadir consulta_stock_pda y compras se olvidó actualizar alguna copia dos
// veces (bugs reales: aparecían en unos sitios sí y en otros no — incluido
// un caso donde un usuario con acceso real a un panel no podía ni loguearse
// porque login/page.tsx no lo reconocía). El seed de SQLite tenía el mismo
// problema latente (se detectó en revisión, antes de causar un incidente:
// un panel nuevo sin fila en `screens` queda público por defecto y ni
// siquiera aparece en la pestaña "Pantallas" de /admin para poder
// restringirlo). Nunca vuelvas a crear una lista de paneles aparte — añade
// aquí y solo aquí.
export const PANELS = [
    { key: 'produccion', label: 'Producción', href: '/produccion', Icon: Factory, description: 'Órdenes de fabricación y merma por planta y línea' },
    { key: 'pedidos', label: 'Pedidos', href: '/preparacion-pedidos', Icon: Package, description: 'Control de preparación de pedidos por planta' },
    { key: 'caducados', label: 'Caducados', href: '/caducados', Icon: AlertTriangle, description: 'Productos caducados o con bloqueo de calidad' },
    { key: 'comparativa', label: 'Comparativa SERES', href: '/comparativa-seres', Icon: ArrowLeftRight, description: 'Comparativa de pedidos EDI SERES vs JDE' },
    { key: 'consulta_stock_pda', label: 'Consulta Stock PDA', href: '/consulta-stock-pda', Icon: ScanBarcode, description: 'Consulta de stock FEFO por escaneo de palet' },
    { key: 'compras', label: 'Compras', href: '/compras', Icon: ShoppingCart, description: 'Previsión de ventas vs. venta real, por artículo y mes' },
    { key: 'mrp', label: 'Explosión de compras', href: '/mrp', Icon: Boxes, description: 'Previsión × lista de materiales → qué comprar de cada material' },
    { key: 'muestras', label: 'Muestras', href: '/muestras', Icon: FlaskConical, description: 'Control de muestras de producto terminado: pendientes, enviadas y completadas' },
] as const

export type PanelKey = typeof PANELS[number]['key']
