"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Factory, Package, AlertTriangle, ArrowLeftRight, LogIn, Loader2 } from "lucide-react"

interface ScreenConfig { is_public: boolean; allowed_roles: string[] }

const PANELS = [
  { key: 'produccion',  label: 'Producción',       href: '/produccion',          Icon: Factory,        description: 'Órdenes de fabricación y merma por planta y línea' },
  { key: 'pedidos',     label: 'Pedidos',           href: '/preparacion-pedidos', Icon: Package,        description: 'Control de preparación de pedidos por planta' },
  { key: 'caducados',   label: 'Caducados',         href: '/caducados',           Icon: AlertTriangle,  description: 'Palets caducados, obsoletos y bloqueados' },
  { key: 'comparativa', label: 'Comparativa SERES', href: '/comparativa-seres',   Icon: ArrowLeftRight, description: 'Comparativa de albaranes SERES vs JDE' },
]

function canAccess(cfg: ScreenConfig | undefined, role: string | null): boolean {
  if (!cfg) return true
  if (cfg.is_public) return true
  if (!role) return false
  if (role === 'admin') return true
  return cfg.allowed_roles.includes(role)
}

export default function HomePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [publicPanels, setPublicPanels] = useState<typeof PANELS>([])

  useEffect(() => {
    const init = async () => {
      try {
        const [meRes, screensRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/screen-permissions'),
        ])

        const screens: Record<string, ScreenConfig> = screensRes.ok ? await screensRes.json() : {}

        if (meRes.ok) {
          const user = await meRes.json()
          if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return }

          // Redirigir al primer panel accesible
          const first = PANELS.find(p => canAccess(screens[p.key], user.role))
          if (first) { router.push(first.href); return }
          // Si no hay ninguno accesible, caer al login
          router.push('/login')
          return
        }

        // Sin sesión: mostrar solo paneles públicos
        setPublicPanels(PANELS.filter(p => screens[p.key]?.is_public ?? true))
      } catch {
        setPublicPanels(PANELS)
      } finally {
        setChecking(false)
      }
    }
    init()
  }, [router])

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
        <Link
          href="/login"
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 bg-white"
        >
          <LogIn className="h-3.5 w-3.5" />
          Iniciar sesión
        </Link>
      </header>

      {/* Contenido */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Panel de Producción</h1>
          <p className="text-sm text-gray-500 mb-8">
            {publicPanels.length > 0
              ? 'Accede a los paneles disponibles sin necesidad de iniciar sesión.'
              : 'Todos los paneles requieren iniciar sesión para acceder.'}
          </p>

          {publicPanels.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {publicPanels.map(({ key, label, href, Icon, description }) => (
                <Link
                  key={key}
                  href={href}
                  className="bg-white border border-gray-200 rounded-lg p-5 hover:border-gray-300 hover:shadow-sm transition-all flex gap-4 items-start group"
                >
                  <div className="mt-0.5 p-2 rounded-md bg-gray-50 group-hover:bg-red-50 transition-colors">
                    <Icon className="h-5 w-5 text-gray-400 group-hover:text-[#D30B15] transition-colors" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-[#D30B15] transition-colors">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-sm text-gray-500">
                Inicia sesión para acceder a los paneles.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-md"
                style={{ backgroundColor: '#D30B15' }}
              >
                <LogIn className="h-4 w-4" />
                Iniciar sesión
              </Link>
            </div>
          )}
        </div>
      </main>

      <footer className="py-4 text-center text-xs text-gray-400">
        Elaborados Naturales
      </footer>
    </div>
  )
}
