import { Factory, Package, AlertTriangle, ArrowLeftRight, ScanBarcode, ShoppingCart } from "lucide-react"

// Fuente única de la verdad de los paneles reales de la app (no incluye /admin,
// que se gestiona aparte por rol). La usan Navbar, la portada (/), el login
// (redirect tras autenticar) y admin (gestión de permisos por pantalla).
//
// ponytail: antes esta misma lista vivía copiada en 4 sitios (Navbar.tsx,
// app/page.tsx, app/login/page.tsx, SCREEN_KEYS de app/admin/page.tsx). Al
// añadir consulta_stock_pda y compras se olvidó actualizar alguna copia dos
// veces (bugs reales: aparecían en unos sitios sí y en otros no — incluido
// un caso donde un usuario con acceso real a un panel no podía ni loguearse
// porque login/page.tsx no lo reconocía). Nunca vuelvas a crear una lista de
// paneles aparte — añade aquí y solo aquí.
export const PANELS = [
    { key: 'produccion', label: 'Producción', href: '/produccion', Icon: Factory, description: 'Órdenes de fabricación y merma por planta y línea' },
    { key: 'pedidos', label: 'Pedidos', href: '/preparacion-pedidos', Icon: Package, description: 'Control de preparación de pedidos por planta' },
    { key: 'caducados', label: 'Caducados', href: '/caducados', Icon: AlertTriangle, description: 'Productos caducados o con bloqueo de calidad' },
    { key: 'comparativa', label: 'Comparativa SERES', href: '/comparativa-seres', Icon: ArrowLeftRight, description: 'Comparativa de pedidos EDI SERES vs JDE' },
    { key: 'consulta_stock_pda', label: 'Consulta Stock PDA', href: '/consulta-stock-pda', Icon: ScanBarcode, description: 'Consulta de stock FEFO por escaneo de palet' },
    { key: 'compras', label: 'Compras', href: '/compras', Icon: ShoppingCart, description: 'Previsión de ventas vs. venta real, por artículo y mes' },
] as const

export type PanelKey = typeof PANELS[number]['key']
