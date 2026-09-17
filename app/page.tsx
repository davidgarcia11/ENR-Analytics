"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Loader2, Lock, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { PANELS } from "@/lib/panels"
import { puedeAcceder, useSession } from "@/components/SessionProvider"

export default function HomePage() {
  const router = useRouter()
  const { user, screens, loading } = useSession()

  // Con sesión, la portada no se llega a ver: es un desvío al primer panel
  // permitido. Sin sesión, hace de escaparate de los paneles públicos.
  useEffect(() => {
    if (loading || !user) return
    if (user.mustChangePassword) { router.push('/cambiar-contrasena'); return }
    const first = PANELS.find(p => puedeAcceder(screens[p.key], user))
    router.push(first ? first.href : '/login')
  }, [loading, user, screens, router])

  const publicPanels = PANELS.filter(p => screens[p.key]?.is_public ?? true)
  const privatePanels = PANELS.filter(p => !(screens[p.key]?.is_public ?? true))

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/50" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">

      {/* Header */}
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Elaborados Naturales" width={26} height={26} priority className="object-contain object-left" />
            <div className="flex flex-col gap-px">
              <span className="text-sm font-medium leading-tight">Elaborados Naturales</span>
              <span className="text-xs leading-none text-muted-foreground/70">Portal de paneles</span>
            </div>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-muted/50 hover:border-muted-foreground/40"
          >
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Iniciar sesión
          </Link>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pb-10 pt-9">

        {/* Title */}
        <div className="mb-8 text-center">
          <h1 className="mb-1.5 text-xl font-medium tracking-tight">Paneles disponibles</h1>
          <p className="text-sm text-muted-foreground/70">
            Accede al panel público o inicia sesión para ver los paneles privados
          </p>
        </div>

        {/* Public */}
        {publicPanels.length > 0 && (
          <section className="mb-6">
            <div className="mb-2.5">
              <Badge variant="success">
                <span className="h-1.5 w-1.5 rounded-full bg-green-700" aria-hidden="true" />
                Acceso público
              </Badge>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {publicPanels.map(({ key, href, Icon, label, description }) => (
                <Link
                  key={key}
                  href={href}
                  className="flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-foreground/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                    <Icon className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 text-sm font-medium">{label}</p>
                    <p className="text-xs leading-snug text-muted-foreground">{description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Private */}
        {privatePanels.length > 0 && (
          <section className="mb-6">
            <div className="mb-2.5">
              <Badge>
                <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                Requiere inicio de sesión
              </Badge>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              {privatePanels.map(({ key, href, Icon, label }) => (
                <Link
                  key={key}
                  href={`/login?redirect=${encodeURIComponent(href)}`}
                  className="block rounded-xl border border-border bg-muted p-3.5 transition-colors hover:border-muted-foreground/40"
                >
                  <div className="mb-2.5 flex items-start justify-between">
                    <Icon className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                    <Lock className="h-3 w-3 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="mb-0.5 text-sm font-medium text-muted-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground/70">Privado</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* All private fallback */}
        {publicPanels.length === 0 && privatePanels.length === 0 && (
          <EmptyState
            icon={Lock}
            title="Acceso restringido"
            description="Inicia sesión para acceder a los paneles."
            className="py-16"
            action={
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:border-muted-foreground/40"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Iniciar sesión
              </Link>
            }
          />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-border px-5 py-4">
        <p className="text-center text-xs text-muted-foreground/70">
          ¿Tienes acceso?{' '}
          <Link href="/login" className="border-b border-border font-medium text-secondary-foreground hover:text-foreground">
            Inicia sesión
          </Link>
          {' '}para ver todos los paneles
        </p>
      </footer>

    </div>
  )
}
