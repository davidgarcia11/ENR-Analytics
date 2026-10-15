import { LayoutDashboard, Blocks, Database } from "lucide-react";
import { PANELS } from "@/lib/panels";

export interface ScreenConfig {
    is_public: boolean;
    allowed_roles: string[];
}

// Reparto de los paneles reales de lib/panels.ts (fuente única, ver CLAUDE.md) entre
// "dashboards" (vistas analíticas de solo lectura) y "apps" (herramientas operativas
// donde el usuario actúa) — misma distinción que docs/compras-v1-historico.md §9.
const DASHBOARD_KEYS = ["produccion", "pedidos", "caducados", "comparativa", "compras", "mrp", "costes", "servicio"] as const;
const APP_KEYS = ["consulta_stock_pda", "muestras", "loteadora"] as const;

// Misma regla que components/Navbar.tsx (canAccessPanel) — una sola definición de
// "quién puede ver este panel en el nav", compartida por los dos sistemas de diseño.
export function canAccessPanel(cfg: ScreenConfig | undefined, role: string | null): boolean {
    if (!cfg) return true;
    if (cfg.is_public) return true;
    if (!role) return false;
    if (role === "admin") return true;
    return cfg.allowed_roles.includes(role);
}

function byKey(keys: readonly string[], role: string | null, screens: Record<string, ScreenConfig>) {
    return PANELS.filter((p) => keys.includes(p.key))
        .filter((p) => canAccessPanel(screens[p.key], role))
        .map((p) => ({
            label: p.label,
            icon: p.Icon,
            href: p.href,
        }));
}

// "Maestros" es solo para admin — ni el grupo se muestra a nadie más (no solo sus
// items). Sin pantalla real todavía (ni Familias y canales ni Artículos existen como
// ruta en la app) — visible por la captura de referencia, pero sin href, deshabilitado.
// No inventar una ruta que no lleva a nada.
function getNavData(role: string | null, screens: Record<string, ScreenConfig>): any[] {
    const data: any[] = [
        {
            type: "dropdown",
            label: "Dashboards",
            icon: LayoutDashboard,
            items: byKey(DASHBOARD_KEYS, role, screens),
        },
        {
            type: "dropdown",
            label: "Apps",
            icon: Blocks,
            items: byKey(APP_KEYS, role, screens),
        },
    ].filter((group) => group.items.length > 0); // sin paneles visibles -> sin grupo, igual que Navbar.tsx

    if (role === "admin") {
        data.push({
            type: "dropdown",
            label: "Maestros",
            icon: Database,
            items: [
                { label: "Familias y canales", icon: Database, href: undefined, disabled: true },
                { label: "Artículos", icon: Database, href: undefined, disabled: true },
            ],
        });
    }
    return data;
}

export { getNavData };
