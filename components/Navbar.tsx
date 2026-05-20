"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  User, LogOut, Settings, FileText, ChevronDown,
  Factory, Package, AlertTriangle, ArrowLeftRight, BookmarkCheck
} from "lucide-react"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

const PANELS = [
  { key: 'produccion',  label: 'Producción',       href: '/produccion',          Icon: Factory },
  { key: 'pedidos',     label: 'Pedidos',           href: '/preparacion-pedidos', Icon: Package },
  { key: 'caducados',   label: 'Caducados',         href: '/caducados',           Icon: AlertTriangle },
  { key: 'comparativa', label: 'Comparativa SERES', href: '/comparativa-seres',   Icon: ArrowLeftRight },
] as const

type PanelKey = typeof PANELS[number]['key']

interface NavbarProps {
  currentPanel: PanelKey
  user: SessionUser | null
  onLogout: () => void
  onPresetsClick?: () => void
}

export default function Navbar({ currentPanel, user, onLogout, onPresetsClick }: NavbarProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const displayName = user
    ? (user.name ? `${user.name} ${user.surname || ''}`.trim() : user.username)
    : null

  return (
    <div className="flex items-center gap-3">
      <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
      <div className="flex-1" />

      {/* Dropdown de paneles */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300"
        >
          Paneles
          <ChevronDown className="h-3 w-3" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-md shadow-lg z-20 py-1">
              {PANELS.map(({ key, label, href, Icon }) => {
                const active = key === currentPanel
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { router.push(href); setOpen(false) }}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 ${active ? 'font-semibold text-gray-900' : 'text-gray-600'}`}
                  >
                    <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${active ? 'text-[#D30B15]' : 'text-gray-400'}`} />
                    {label}
                    {active && <span className="ml-auto" style={{ color: '#D30B15' }}>●</span>}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Presets — solo en producción y solo con sesión activa */}
      {onPresetsClick && user && (
        <button
          type="button"
          onClick={onPresetsClick}
          className="text-xs font-medium px-2.5 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 flex items-center gap-1.5"
        >
          <BookmarkCheck className="h-3.5 w-3.5" />
          Presets
        </button>
      )}

      {/* Auth */}
      {user ? (
        <>
          <span className="text-sm text-gray-600 flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            {displayName}
          </span>
          {user.role === 'admin' && (
            <>
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <Settings className="h-3.5 w-3.5" />
                Admin
              </button>
              <button
                type="button"
                onClick={() => router.push('/admin/logs')}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <FileText className="h-3.5 w-3.5" />
                Logs
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir
          </button>
        </>
      ) : (
        <a
          href="/login"
          className="text-xs font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 hover:border-gray-300"
        >
          <User className="h-3.5 w-3.5" />
          Iniciar sesión
        </a>
      )}
    </div>
  )
}
