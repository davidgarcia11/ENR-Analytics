"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import {
  User, LogOut, Settings, FileText, ChevronDown,
  Factory, Package, AlertTriangle, ArrowLeftRight, BookmarkCheck
} from "lucide-react"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface ScreenConfig { is_public: boolean; allowed_roles: string[] }

const PANELS = [
  { key: 'produccion',  label: 'Producción',       href: '/produccion',          Icon: Factory },
  { key: 'pedidos',     label: 'Pedidos',           href: '/preparacion-pedidos', Icon: Package },
  { key: 'caducados',   label: 'Caducados',         href: '/caducados',           Icon: AlertTriangle },
  { key: 'comparativa', label: 'Comparativa SERES', href: '/comparativa-seres',   Icon: ArrowLeftRight },
] as const

type PanelKey = typeof PANELS[number]['key']

interface NavbarProps {
  // Opcional: páginas que no son uno de los 4 paneles (ej. /admin/logs) no marcan ninguno como activo
  currentPanel?: PanelKey
  user: SessionUser | null
  onLogout: () => void
  onPresetsClick?: () => void
}

function canAccessPanel(cfg: ScreenConfig | undefined, role: string | null): boolean {
  if (!cfg) return true
  if (cfg.is_public) return true
  if (!role) return false
  if (role === 'admin') return true
  return cfg.allowed_roles.includes(role)
}

export default function Navbar({ currentPanel, user, onLogout, onPresetsClick }: NavbarProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [screensConfig, setScreensConfig] = useState<Record<string, ScreenConfig>>({})

  useEffect(() => {
    fetch('/api/screen-permissions')
      .then(r => r.ok ? r.json() : {})
      .then(setScreensConfig)
      .catch(() => {})
  }, [])

  const visiblePanels = PANELS.filter(p => canAccessPanel(screensConfig[p.key], user?.role ?? null))

  const displayName = user
    ? (user.name ? `${user.name} ${user.surname || ''}`.trim() : user.username)
    : null

  return (
    // flex-wrap: en pantallas estrechas (tablet vertical) los botones bajan de línea en vez de solaparse
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
      <div className="flex-1" />

      {/* Dropdown de paneles */}
      {visiblePanels.length > 0 && (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Paneles
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div role="menu" className="absolute right-0 mt-1 w-52 bg-popover border border-border rounded-md shadow-lg z-20 py-1">
              {visiblePanels.map(({ key, label, href, Icon }) => {
                const active = key === currentPanel
                return (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    onClick={() => { router.push(href); setOpen(false) }}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted ${active ? 'font-semibold text-foreground' : 'text-secondary-foreground'}`}
                  >
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/60'}`} aria-hidden="true" />
                    {label}
                    {active && <span className="ml-auto text-primary" aria-hidden="true">●</span>}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      )}

      {/* Presets — solo en producción y solo con sesión activa */}
      {onPresetsClick && user && (
        <button
          type="button"
          onClick={onPresetsClick}
          className="text-xs font-medium px-2.5 py-1 rounded-md border border-border bg-card hover:bg-muted flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Presets
        </button>
      )}

      {/* Auth */}
      {user ? (
        <>
          {/* El nombre se oculta en pantallas muy estrechas para no romper la fila */}
          <span className="text-sm text-secondary-foreground hidden sm:flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            {displayName}
          </span>
          {user.role === 'admin' && (
            <>
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                Admin
              </button>
              <button
                type="button"
                onClick={() => router.push('/admin/logs')}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Logs
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Salir
          </button>
        </>
      ) : (
        <a
          href="/login"
          className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border hover:border-muted-foreground/40"
        >
          <User className="h-3.5 w-3.5" aria-hidden="true" />
          Iniciar sesión
        </a>
      )}
    </div>
  )
}
