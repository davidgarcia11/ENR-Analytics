"use client"

// Panel de administración sobre Nova, con la estructura de los dashboards de
// ShadcnSpace: sidebar real (logo, secciones agrupadas y "Ir a paneles" abajo) y, a
// la derecha, una cabecera fina (botón del sidebar, ruta de la sección y acciones de
// usuario) con la sección activa debajo, a todo el ancho. Cada sección es un
// componente propio en components/nova/admin/ que pinta su propia cabecera (título,
// descripción y acción principal) y carga sus datos al montarse — ver
// DOCUMENTACION.md §5.
import { Suspense, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { RequireAccess, useSession } from "@/components/SessionProvider"
import ModeToggle, { type ThemeMode } from "@/components/nova/mode-toggle"
import { NovaPortalProvider } from "@/components/nova/portal-container"
import { Toaster } from "@/components/nova/ui/sonner"
import { Separator } from "@/components/nova/ui/separator"
import { Avatar, AvatarFallback } from "@/components/nova/ui/avatar"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/nova/ui/breadcrumb"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/nova/ui/sidebar"
import NotificationDropdown from "@/components/shadcn-space/blocks/topbar-02/header/notification-dropdown"
import ProfileDropdown, { iniciales } from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-profile"
import { getNavData } from "@/components/shadcn-space/blocks/topbar-02/data"
import {
  BellRing, ChevronsUpDown, FileCode, FileText, History, LayoutGrid, Link2, MapPin, Printer, Receipt, RefreshCw, ScanBarcode, Settings, ShieldCheck, Tag, Users,
  type LucideIcon,
} from "lucide-react"
import { puedeEntrarEnAdmin, seccionesAdminPorPermisos } from "@/lib/permisos"
import type { SeccionProps } from "@/components/nova/admin/comun"
import AdminUsuarios from "@/components/nova/admin/usuarios"
import AdminRolesPermisos from "@/components/nova/admin/roles-permisos"
import AdminEstadosJde from "@/components/nova/admin/estados-jde"
import AdminLoteadoras from "@/components/nova/admin/loteadoras"
import AdminPlantillas from "@/components/nova/admin/plantillas"
import AdminArticulosPlantilla from "@/components/nova/admin/articulos-plantilla"
import AdminDatosFijos from "@/components/nova/admin/datos-fijos"
import AdminZonas from "@/components/nova/admin/zonas"
import AdminRegistroLoteadora from "@/components/nova/admin/registro-loteadora"
import AdminMuestrasSync from "@/components/nova/admin/muestras-sync"
import AdminLogsConsultas from "@/components/nova/admin/logs-consultas"
import AdminConfirmacionesPda from "@/components/nova/admin/confirmaciones-pda"

// ─── Navegación del panel (sidebar) ─────────────────────────────────────────────
// Una sección nueva se añade aquí (y, si debe poder abrirla alguien que no es admin,
// con su permiso en lib/permisos.ts → seccionAdmin, usando la misma `key`).
interface SeccionAdmin {
  key: string
  label: string
  descripcion: string
  icon: LucideIcon
  Componente: React.ComponentType<SeccionProps>
}

interface GrupoAdmin {
  label: string
  secciones: SeccionAdmin[]
}

const GRUPOS_ADMIN: GrupoAdmin[] = [
  {
    label: "Accesos",
    secciones: [
      { key: "usuarios", label: "Usuarios", descripcion: "Quién entra en la app, con qué rol y con qué excepciones", icon: Users, Componente: AdminUsuarios },
      { key: "roles-permisos", label: "Roles y permisos", descripcion: "Qué puede ver y configurar cada rol", icon: ShieldCheck, Componente: AdminRolesPermisos },
    ],
  },
  {
    label: "Loteadora",
    secciones: [
      { key: "loteadoras", label: "Máquinas", descripcion: "Loteadoras, su conexión y su línea de fabricación", icon: Printer, Componente: AdminLoteadoras },
      { key: "zonas", label: "Zonas", descripcion: "Zonas de las loteadoras y qué roles y usuarios ven cada una", icon: MapPin, Componente: AdminZonas },
      { key: "plantillas", label: "Plantillas", descripcion: "Mensajes de las máquinas: sus campos y qué se imprime en cada uno", icon: FileCode, Componente: AdminPlantillas },
      { key: "articulos-plantilla", label: "Artículos", descripcion: "Qué plantilla se carga al elegir cada artículo en /loteadora", icon: Link2, Componente: AdminArticulosPlantilla },
      { key: "datos-fijos", label: "Datos fijos", descripcion: "Precios, nº de certificado y otros valores fijos de las plantillas", icon: Receipt, Componente: AdminDatosFijos },
      { key: "registro-loteadora", label: "Registro", descripcion: "Todo lo enviado a las loteadoras: qué, a qué máquina, cuándo, quién y cómo fue", icon: History, Componente: AdminRegistroLoteadora },
    ],
  },
  {
    label: "Datos",
    secciones: [
      { key: "estados-jde", label: "Estados JDE", descripcion: "Descripciones de los estados de pedido de Comparativa SERES", icon: Tag, Componente: AdminEstadosJde },
      { key: "muestras", label: "Muestras", descripcion: "Caché de /muestras y sincronización manual", icon: RefreshCw, Componente: AdminMuestrasSync },
      { key: "logs", label: "Logs de consultas", descripcion: "Consultas ejecutadas por panel y usuario, y su rendimiento", icon: FileText, Componente: AdminLogsConsultas },
      { key: "confirmaciones-pda", label: "Confirmaciones PDA", descripcion: "Avisos de Consulta Stock PDA que aceptó cada operario al escanear", icon: ScanBarcode, Componente: AdminConfirmacionesPda },
    ],
  },
]

const TODAS_LAS_SECCIONES = GRUPOS_ADMIN.flatMap(g => g.secciones)
const grupoDe = (key: string) => GRUPOS_ADMIN.find(g => g.secciones.some(s => s.key === key))

// Salida a los paneles de la app (Dashboards / Apps), filtrados por permisos igual
// que el nav de la cabecera del resto de paneles Nova (topbar-02/data.ts).
function IrAPaneles() {
  const router = useRouter()
  const { user, screens } = useSession()
  const grupos = getNavData(user?.role ?? null, screens) as {
    label: string
    items: { label: string; icon: LucideIcon; href?: string; disabled?: boolean }[]
  }[]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton className="border border-sidebar-border bg-background" />}>
        <LayoutGrid />
        <span>Ir a paneles</span>
        <ChevronsUpDown className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
        {grupos.map((g, i) => (
          <DropdownMenuGroup key={g.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">{g.label}</DropdownMenuLabel>
            {g.items.map(item => (
              <DropdownMenuItem
                key={item.label}
                disabled={item.disabled || !item.href}
                onClick={() => item.href && router.push(item.href)}
              >
                <item.icon />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AdminSidebar({ visibles, activa, onSelect, esAdmin }: {
  visibles: string[]
  activa: string
  onSelect: (key: string) => void
  esAdmin: boolean
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const elegir = (key: string) => { onSelect(key); if (isMobile) setOpenMobile(false) }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="px-3 pt-4 pb-2">
        {/* Logo completo abierto; icono cuadrado cuando está colapsado */}
        <div className="group-data-[collapsible=icon]:hidden">
          <Image src="/logo.png" alt="Elaborados Naturales" width={112} height={50} priority className="h-10 w-auto" />
          <p className="mt-2 text-xs font-medium text-muted-foreground">{esAdmin ? "Administración" : "Configuración"}</p>
        </div>
        <div className="hidden size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground group-data-[collapsible=icon]:flex">
          <Settings className="size-4" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {GRUPOS_ADMIN.map(grupo => {
          const secciones = grupo.secciones.filter(s => visibles.includes(s.key))
          if (secciones.length === 0) return null
          return (
            <SidebarGroup key={grupo.label}>
              <SidebarGroupLabel>{grupo.label}</SidebarGroupLabel>
              <SidebarMenu>
                {secciones.map(s => (
                  <SidebarMenuItem key={s.key}>
                    <SidebarMenuButton isActive={activa === s.key} tooltip={s.label} onClick={() => elegir(s.key)}>
                      <s.icon />
                      <span>{s.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          )
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <IrAPaneles />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

// Cabecera fina del área de contenido: botón del sidebar + ruta a la izquierda,
// tema/avisos/perfil a la derecha (los mismos componentes que topbar-02).
function AdminCabecera({ seccion, mode, onModeChange }: {
  seccion?: SeccionAdmin
  mode: ThemeMode
  onModeChange: (m: ThemeMode) => void
}) {
  const { user, logout } = useSession()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem className="hidden sm:block">{seccion ? grupoDe(seccion.key)?.label : ""}</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden sm:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{seccion?.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        <ModeToggle mode={mode} onChange={onModeChange} />
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
  )
}

function AdminPanel() {
  const { user: sessionUser } = useSession()

  // Admin ve todas las secciones; el resto, solo las que le desbloquean sus permisos
  // (de su rol o suyos, lib/permisos.ts). El servidor lo vuelve a comprobar en cada ruta.
  const esAdmin = sessionUser?.role === "admin"
  const permitidas = seccionesAdminPorPermisos(sessionUser?.permisos ?? [])
  const visibles = TODAS_LAS_SECCIONES.map(s => s.key).filter(k => esAdmin || permitidas.includes(k))

  // La sección activa vive en la URL (?seccion=) para que recargar no te devuelva a la
  // primera y se pueda enlazar a una concreta (/admin/logs redirige aquí). Se lee con
  // useSearchParams y no con window.location: en una navegación en cliente (la de
  // /admin/logs) el componente se monta antes de que el navegador cambie la URL.
  const searchParams = useSearchParams()
  const [activa, setActiva] = useState(() => {
    const pedida = searchParams.get("seccion")
    return pedida && visibles.includes(pedida) ? pedida : visibles[0] ?? "usuarios"
  })
  const cambiarSeccion = (key: string) => {
    setActiva(key)
    window.history.replaceState(null, "", `/admin?seccion=${encodeURIComponent(key)}`)
  }
  const seccion = TODAS_LAS_SECCIONES.find(s => s.key === activa)

  const [mode, setMode] = useState<ThemeMode>("system")
  const [systemPrefersDark, setSystemPrefersDark] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemPrefersDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  const effectiveTheme = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode
  const portalContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div data-nova-theme={effectiveTheme} ref={portalContainerRef} className="bg-sidebar text-foreground">
      <NovaPortalProvider container={portalContainerRef}>
        <SidebarProvider>
          <AdminSidebar visibles={visibles} activa={activa} onSelect={cambiarSeccion} esAdmin={esAdmin} />
          <SidebarInset className="overflow-hidden md:outline md:outline-border">
            <AdminCabecera seccion={seccion} mode={mode} onModeChange={setMode} />
            <main className="flex w-full flex-col gap-6 p-4 md:p-6">
              {/* key: al cambiar de sección se monta de cero y recarga sus datos */}
              {seccion && <seccion.Componente key={seccion.key} titulo={seccion.label} descripcion={seccion.descripcion} />}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </NovaPortalProvider>
    </div>
  )
}

// Entra el admin, o un usuario con algún permiso que desbloquee una sección de este
// panel (lib/permisos.ts) — misma regla que proxy.ts aplica antes de mandar el HTML.
export default function AdminPage() {
  return (
    <RequireAccess allow={puedeEntrarEnAdmin}>
      {/* useSearchParams exige un Suspense por encima para no romper el prerender */}
      <Suspense>
        <AdminPanel />
      </Suspense>
    </RequireAccess>
  )
}
