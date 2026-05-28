"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import {
  Factory, Package, AlertTriangle, ArrowLeftRight,
  Loader2, Lock, ArrowRight,
} from "lucide-react"

interface ScreenConfig { is_public: boolean; allowed_roles: string[] }

const PANELS = [
  {
    key: 'produccion',
    label: 'Producción',
    href: '/produccion',
    Icon: Factory,
    description: 'Órdenes de fabricación y merma por planta y línea',
  },
  {
    key: 'pedidos',
    label: 'Pedidos',
    href: '/preparacion-pedidos',
    Icon: Package,
    description: 'Control de preparación de pedidos por planta',
  },
  {
    key: 'caducados',
    label: 'Caducados y bloqueados',
    href: '/caducados',
    Icon: AlertTriangle,
    description: 'Productos caducados o con bloqueo de calidad',
  },
  {
    key: 'comparativa',
    label: 'Comparativa SERES',
    href: '/comparativa-seres',
    Icon: ArrowLeftRight,
    description: 'Comparativa de pedidos EDI SERES vs JDE',
  },
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
  const [privatePanels, setPrivatePanels] = useState<typeof PANELS>([])

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
          const first = PANELS.find(p => canAccess(screens[p.key], user.role))
          if (first) { router.push(first.href); return }
          router.push('/login')
          return
        }

        const pub = PANELS.filter(p => screens[p.key]?.is_public ?? true)
        const priv = PANELS.filter(p => !(screens[p.key]?.is_public ?? true))
        setPublicPanels(pub)
        setPrivatePanels(priv)
      } catch {
        setPublicPanels(PANELS)
        setPrivatePanels([])
      } finally {
        setChecking(false)
      }
    }
    init()
  }, [router])

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F7F7F6' }}>
        <Loader2 style={{ width: 16, height: 16, color: '#D1D5DB', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .hp-root { min-height: 100vh; display: flex; flex-direction: column; background: #F7F7F6; font-family: 'Inter', var(--font-geist-sans), system-ui, sans-serif; color: #111; }
        .hp-header { position: sticky; top: 0; z-index: 20; background: #fff; border-bottom: 1px solid #EBEBEB; }
        .hp-header-inner { max-width: 720px; margin: 0 auto; padding: 0 20px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
        .hp-logo-block { display: flex; align-items: center; gap: 10px; }
        .hp-logo-text { display: flex; flex-direction: column; gap: 1px; }
        .hp-logo-name { font-size: 13.5px; font-weight: 500; color: #111; line-height: 1.2; }
        .hp-logo-sub { font-size: 11px; color: #B0B0B0; line-height: 1; }
        .hp-login-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #374151; background: #fff; border: 1px solid #DCDCDC; border-radius: 8px; padding: 6px 13px; text-decoration: none; transition: border-color .15s, background .15s; }
        .hp-login-btn:hover { border-color: #BDBDBD; background: #FAFAFA; }
        .hp-main { flex: 1; max-width: 720px; margin: 0 auto; padding: 36px 20px 40px; width: 100%; }
        .hp-title { text-align: center; margin-bottom: 32px; }
        .hp-h1 { font-size: 20px; font-weight: 500; color: #111; letter-spacing: -.01em; margin: 0 0 6px; }
        .hp-subtitle { font-size: 13px; color: #B0B0B0; margin: 0; }
        .hp-section { margin-bottom: 24px; }
        .hp-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 500; border-radius: 999px; padding: 3px 9px; margin-bottom: 10px; }
        .hp-badge-public { color: #3A6B10; background: #EEF6E6; border: 1px solid #C8E6A0; }
        .hp-badge-public-dot { width: 6px; height: 6px; border-radius: 50%; background: #3A6B10; }
        .hp-badge-private { color: #6B7280; background: #F4F4F4; border: 1px solid #E5E5E5; }
        .hp-grid-public { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
        .hp-grid-private { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
        .hp-card-public { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid #E5E5E5; border-radius: 12px; padding: 15px 16px; text-decoration: none; color: inherit; transition: border-color .15s; }
        .hp-card-public:hover { border-color: #C4C4C4; }
        .hp-card-icon { width: 38px; height: 38px; border-radius: 9px; background: #FEF3C7; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .hp-card-icon svg { width: 17px; height: 17px; color: #D97706; }
        .hp-card-body { flex: 1; min-width: 0; }
        .hp-card-name { font-size: 13.5px; font-weight: 500; color: #111; margin: 0 0 2px; }
        .hp-card-desc { font-size: 12px; color: #9CA3AF; margin: 0; line-height: 1.45; }
        .hp-card-arrow { width: 15px; height: 15px; color: #D1D5DB; flex-shrink: 0; }
        .hp-card-private { display: block; background: #F4F4F4; border: 1px solid #E5E5E5; border-radius: 12px; padding: 14px; text-decoration: none; transition: border-color .15s; }
        .hp-card-private:hover { border-color: #C4C4C4; }
        .hp-card-private-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        .hp-card-private-top svg { width: 17px; height: 17px; color: #C4C4C4; }
        .hp-card-private-lock { width: 12px; height: 12px; color: #D1D5DB; }
        .hp-card-private-name { font-size: 13px; font-weight: 500; color: #6B7280; margin: 0 0 2px; }
        .hp-card-private-hint { font-size: 11px; color: #B0B0B0; margin: 0; }
        .hp-footer { border-top: 1px solid #EBEBEB; padding: 16px 20px; }
        .hp-footer p { text-align: center; font-size: 12px; color: #B0B0B0; margin: 0; }
        .hp-footer a { color: #374151; text-decoration: none; font-weight: 500; border-bottom: 1px solid #E5E5E5; }
        .hp-footer a:hover { color: #111; }
        .hp-empty { text-align: center; padding: 64px 0; }
        .hp-empty-icon { width: 20px; height: 20px; color: #D1D5DB; margin: 0 auto 12px; }
        .hp-empty-title { font-size: 14px; font-weight: 500; color: #374151; margin: 0 0 4px; }
        .hp-empty-sub { font-size: 12px; color: #9CA3AF; margin: 0 0 20px; }
        .hp-empty-btn { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #374151; background: #fff; border: 1px solid #DCDCDC; border-radius: 8px; padding: 7px 14px; text-decoration: none; }
        .hp-empty-btn:hover { border-color: #BDBDBD; }
      `}</style>

      <div className="hp-root">

        {/* Header */}
        <header className="hp-header">
          <div className="hp-header-inner">
            <div className="hp-logo-block">
              <Image src="/logo.png" alt="Elaborados Naturales" width={26} height={26} priority style={{ objectFit: 'contain', objectPosition: 'left' }} />
              <div className="hp-logo-text">
                <span className="hp-logo-name">Elaborados Naturales</span>
                <span className="hp-logo-sub">Portal de paneles</span>
              </div>
            </div>
            <Link href="/login" className="hp-login-btn">
              <Lock style={{ width: 13, height: 13, color: '#9CA3AF' }} />
              Iniciar sesión
            </Link>
          </div>
        </header>

        {/* Main */}
        <main className="hp-main">

          {/* Title */}
          <div className="hp-title">
            <h1 className="hp-h1">Paneles disponibles</h1>
            <p className="hp-subtitle">
              Accede al panel público o inicia sesión para ver los paneles privados
            </p>
          </div>

          {/* Public */}
          {publicPanels.length > 0 && (
            <section className="hp-section">
              <div>
                <span className="hp-badge hp-badge-public">
                  <span className="hp-badge-public-dot" />
                  Acceso público
                </span>
              </div>
              <div className="hp-grid-public">
                {publicPanels.map(({ key, href, Icon, label, description }) => (
                  <Link key={key} href={href} className="hp-card-public">
                    <div className="hp-card-icon">
                      <Icon />
                    </div>
                    <div className="hp-card-body">
                      <p className="hp-card-name">{label}</p>
                      <p className="hp-card-desc">{description}</p>
                    </div>
                    <ArrowRight className="hp-card-arrow" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Private */}
          {privatePanels.length > 0 && (
            <section className="hp-section">
              <div>
                <span className="hp-badge hp-badge-private">
                  <Lock style={{ width: 10, height: 10 }} />
                  Requiere inicio de sesión
                </span>
              </div>
              <div className="hp-grid-private">
                {privatePanels.map(({ key, href, Icon, label }) => (
                  <Link key={key} href={`/login?redirect=${encodeURIComponent(href)}`} className="hp-card-private">
                    <div className="hp-card-private-top">
                      <Icon />
                      <Lock className="hp-card-private-lock" />
                    </div>
                    <p className="hp-card-private-name">{label}</p>
                    <p className="hp-card-private-hint">Privado</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* All private fallback */}
          {publicPanels.length === 0 && privatePanels.length === 0 && (
            <div className="hp-empty">
              <Lock className="hp-empty-icon" />
              <p className="hp-empty-title">Acceso restringido</p>
              <p className="hp-empty-sub">Inicia sesión para acceder a los paneles.</p>
              <Link href="/login" className="hp-empty-btn">
                <Lock style={{ width: 13, height: 13 }} />
                Iniciar sesión
              </Link>
            </div>
          )}

        </main>

        {/* Footer */}
        <footer className="hp-footer">
          <p>
            ¿Tienes acceso?{' '}
            <Link href="/login">Inicia sesión</Link>
            {' '}para ver todos los paneles
          </p>
        </footer>

      </div>
    </>
  )
}
