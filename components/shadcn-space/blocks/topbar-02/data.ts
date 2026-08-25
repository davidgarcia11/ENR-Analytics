import { LayoutDashboard, Blocks, Database } from "lucide-react";
import { PANELS } from "@/lib/panels";

// Reparto de los paneles reales de lib/panels.ts (fuente única, ver CLAUDE.md) entre
// "dashboards" (vistas analíticas de solo lectura) y "apps" (herramientas operativas
// donde el usuario actúa) — misma distinción que docs/compras-v1-historico.md §9.
const DASHBOARD_KEYS = ["produccion", "caducados", "comparativa", "compras"] as const;
const APP_KEYS = ["pedidos", "consulta_stock_pda"] as const;

const byKey = (keys: readonly string[]) =>
    PANELS.filter((p) => keys.includes(p.key)).map((p) => ({
        label: p.label,
        icon: p.Icon,
        href: p.href,
    }));

const NavData: any[] = [
    {
        type: "dropdown",
        label: "Dashboards",
        icon: LayoutDashboard,
        items: byKey(DASHBOARD_KEYS),
    },
    {
        type: "dropdown",
        label: "Apps",
        icon: Blocks,
        items: byKey(APP_KEYS),
    },
    {
        type: "dropdown",
        label: "Maestros",
        icon: Database,
        // Sin pantalla real todavía (ni Familias y canales ni Artículos existen como
        // ruta en la app) — visibles per la captura, pero sin href, deshabilitados.
        // No inventar una ruta que no lleva a nada.
        items: [
            { label: "Familias y canales", icon: Database, href: undefined, disabled: true },
            { label: "Artículos", icon: Database, href: undefined, disabled: true },
        ],
    },
];

export default NavData;
