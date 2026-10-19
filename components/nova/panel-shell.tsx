"use client";

// Armazón común de los paneles Nova: barra lateral = bloque oficial Sidebar 01 de
// ShadcnSpace (components/shadcn-space/blocks/sidebar-01, instalado con el CLI y adaptado
// por props) + cabecera fina con el botón de la barra, la ruta, el tema, los avisos y el
// perfil. Sustituye a la barra de
// arriba (topbar-02) en /compras, /mrp, /costes, /muestras y /servicio. Se encarga del tema
// claro/oscuro/sistema, del contenedor de portales y del <Toaster />.
//
// Navegación: los grupos Dashboards / Apps salen de getNavData() (topbar-02/data.ts, que a
// su vez sale de lib/panels.ts y filtra por permisos), igual que antes en la barra de
// arriba. Un panel puede tener subsecciones propias (SECCIONES_PANEL, lib/panels.ts), que salen como
// submenú con flecha en la barra de todos los paneles; p. ej. /servicio: Seguimiento / Indicadores.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BellRing, type LucideIcon } from "lucide-react";
import { useSession } from "@/components/SessionProvider";
import ModeToggle, { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import { Toaster } from "@/components/nova/ui/sonner";
import { Separator } from "@/components/nova/ui/separator";
import { Avatar, AvatarFallback } from "@/components/nova/ui/avatar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/nova/ui/breadcrumb";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/nova/ui/sidebar";
import { AppSidebar, type NavItem as BloqueNavItem } from "@/components/shadcn-space/blocks/sidebar-01/app-sidebar";
import NotificationDropdown from "@/components/shadcn-space/blocks/topbar-02/header/notification-dropdown";
import ProfileDropdown, { iniciales } from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-profile";
import { getNavData } from "@/components/shadcn-space/blocks/topbar-02/data";
import { PANELS, SECCIONES_PANEL } from "@/lib/panels";

interface NavItem { label: string; icon: LucideIcon; href?: string }
interface NavGrupo { label: string; items: NavItem[] }

export default function NovaPanelShell({ title, grupo, seccionActiva, onSeccion, children }: {
  /** Nombre del panel (migas de pan y título del grupo de secciones). */
  title: string;
  /** Grupo del nav al que pertenece el panel, para la miga: «Dashboards» o «Apps». */
  grupo?: string;
  /** Sección elegida del panel actual (sus secciones salen de SECCIONES_PANEL, lib/panels.ts). */
  seccionActiva?: string;
  onSeccion?: (key: string) => void;
  children: ReactNode;
}) {
  const { user, screens, logout } = useSession();

  const [mode, setMode] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const effectiveTheme = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
  const portalContainerRef = useRef<HTMLDivElement>(null);

  // Solo grupos con paneles navegables: «Maestros» (solo admin) son huecos sin ruta todavía.
  const grupos = (getNavData(user?.role ?? null, screens) as NavGrupo[])
    .map((g) => ({ ...g, items: g.items.filter((i) => i.href) }))
    .filter((g) => g.items.length > 0);
  const pathname = usePathname();
  const panelActual = PANELS.find((p) => p.href === pathname);
  const seccion = (panelActual ? SECCIONES_PANEL[panelActual.key] : undefined)?.find((s) => s.key === seccionActiva);

  // Menú del bloque Sidebar 01: una sección por grupo (DASHBOARDS / APPS). Los paneles con
  // secciones propias llevan SIEMPRE su submenú con la flecha (como «Blogs» en el bloque
  // original), no solo cuando estás dentro: en el panel actual son botones que cambian de
  // sección; desde otro panel son enlaces a /<panel>?seccion=<key>.
  const menu: BloqueNavItem[] = grupos.flatMap((g) => [
    { label: g.label, isSection: true } as BloqueNavItem,
    ...g.items.map((item): BloqueNavItem => {
      const activo = item.href === pathname;
      const def = PANELS.find((p) => p.href === item.href);
      const secciones = def ? SECCIONES_PANEL[def.key] : undefined;
      return {
        title: item.label,
        icon: item.icon,
        href: item.href,
        active: activo,
        children: secciones?.map((sec) => activo
          ? { title: sec.label, active: seccionActiva === sec.key, onSelect: () => onSeccion?.(sec.key) }
          : { title: sec.label, href: `${item.href}?seccion=${sec.key}` }),
      };
    }),
  ]);

  return (
    <div data-nova-theme={effectiveTheme} ref={portalContainerRef} className="bg-sidebar text-foreground">
      <NovaPortalProvider container={portalContainerRef}>
        <SidebarProvider>
          <AppSidebar items={menu} />
          <SidebarInset className="overflow-hidden md:outline md:outline-border md:peer-data-[variant=inset]:shadow-[0_0.125rem_0.25rem_rgba(0,0,0,0.075)]">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
              <Breadcrumb>
                <BreadcrumbList>
                  {grupo && (
                    <>
                      <BreadcrumbItem className="hidden sm:block">{grupo}</BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden sm:block" />
                    </>
                  )}
                  <BreadcrumbItem>
                    {seccion ? <span>{title}</span> : <BreadcrumbPage>{title}</BreadcrumbPage>}
                  </BreadcrumbItem>
                  {seccion && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem><BreadcrumbPage>{seccion.label}</BreadcrumbPage></BreadcrumbItem>
                    </>
                  )}
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto flex items-center gap-1">
                <ModeToggle mode={mode} onChange={setMode} />
                <NotificationDropdown
                  defaultOpen={false}
                  align="end"
                  trigger={<div className="rounded-full p-2 hover:bg-accent"><BellRing className="size-4" /></div>}
                />
                <ProfileDropdown
                  user={user}
                  onLogout={logout}
                  trigger={
                    <div className="cursor-pointer rounded-full">
                      <Avatar className="size-7 rounded-full">
                        <AvatarFallback>{user ? iniciales(user) : "?"}</AvatarFallback>
                      </Avatar>
                    </div>
                  }
                />
              </div>
            </header>
            <main className="flex w-full flex-col gap-4 p-4 md:p-6">{children}</main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </NovaPortalProvider>
    </div>
  );
}
