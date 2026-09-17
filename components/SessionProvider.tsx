"use client"

// Estado de sesión compartido por toda la app.
//
// Antes, cada panel se montaba su propio `fetch('/api/auth/me')` en un useEffect
// (13 copias en cuatro formas distintas) y cada uno decidía a su manera si
// redirigir. Eso traía tres problemas que este provider resuelve de raíz:
//
// 1. La sesión solo se comprobaba AL MONTAR. Si el token caducaba con el panel
//    abierto (tablet de planta que no se cierra en días), el usuario se quedaba
//    delante de una pantalla que ya no valía hasta que tocaba algo.
// 2. La página se pintaba primero y el useEffect decidía después: de ahí el
//    "flash" de un panel al que no tienes acceso antes de ir al login.
// 3. La regla de "¿puede ver este panel?" estaba copiada en 5 páginas, en los
//    dos navbars y en el login — con matices distintos entre copias.
//
// El provider NO redirige por su cuenta: solo mantiene el estado. Quien decide
// es <RequireAccess>, que cada página envuelve alrededor de su contenido.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

export interface SessionUser {
  id: number
  username: string
  role: string
  name: string
  surname: string
  mustChangePassword: boolean
  defaultPlant: string
  canConfigureMuestras: boolean
}

export interface ScreenConfig {
  is_public: boolean
  allowed_roles: string[]
}

interface SessionContextValue {
  user: SessionUser | null
  screens: Record<string, ScreenConfig>
  /** true hasta que la primera comprobación termina — úsalo para no pintar nada todavía */
  loading: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
  /** Lo llama useApiFetch al ver un 401: la sesión murió a media faena */
  onSessionExpired: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

/** Cada cuánto se revalida la sesión con el servidor mientras la pestaña está abierta */
const REVALIDATE_MS = 60_000

// Solo rutas internas: un `next` con http(s):// o // sería un open redirect.
function rutaInternaSegura(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//")
}

export function loginUrlPara(path: string): string {
  return rutaInternaSegura(path) && path !== "/login"
    ? `/login?next=${encodeURIComponent(path)}`
    : "/login"
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [screens, setScreens] = useState<Record<string, ScreenConfig>>({})
  const [loading, setLoading] = useState(true)

  // Para distinguir "nunca hubo sesión" de "la había y se ha perdido": solo en
  // el segundo caso se avisa y se echa al login. Es un ref y no estado porque
  // se lee dentro del intervalo, que no debe re-crearse en cada render.
  const teniaSesion = useRef(false)

  const cargar = useCallback(async () => {
    try {
      const [meRes, screensRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/screen-permissions"),
      ])
      const nuevoUsuario: SessionUser | null = meRes.ok ? await meRes.json() : null
      if (screensRes.ok) setScreens(await screensRes.json())

      if (!nuevoUsuario && teniaSesion.current) {
        teniaSesion.current = false
        setUser(null)
        router.push(loginUrlPara(pathname))
        return
      }
      teniaSesion.current = !!nuevoUsuario
      setUser(nuevoUsuario)
    } catch {
      // Un fallo de red no es una sesión caducada: se deja el estado como está
      // en vez de echar al usuario del panel por un corte de un segundo.
    } finally {
      setLoading(false)
    }
  }, [router, pathname])

  useEffect(() => { cargar() }, [cargar])

  // Revalidación periódica + al volver a la pestaña. Lo segundo es lo que hace
  // que volver a una tablet olvidada te lleve al login al instante en vez de
  // esperar al siguiente ciclo.
  useEffect(() => {
    const interval = setInterval(cargar, REVALIDATE_MS)
    const alVolver = () => { if (document.visibilityState === "visible") cargar() }
    document.addEventListener("visibilitychange", alVolver)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", alVolver)
    }
  }, [cargar])

  const onSessionExpired = useCallback(() => {
    teniaSesion.current = false
    setUser(null)
    router.push(loginUrlPara(pathname))
  }, [router, pathname])

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    teniaSesion.current = false
    setUser(null)
    router.push("/login")
  }, [router])

  return (
    <SessionContext.Provider value={{ user, screens, loading, refresh: cargar, logout, onSessionExpired }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession fuera de <SessionProvider> — móntalo en app/layout.tsx")
  return ctx
}

/**
 * fetch con el 401 ya resuelto: avisa y manda al login en vez de dejar que cada
 * panel muestre "No autenticado" como si fuera un error cualquiera.
 * Devuelve la Response para que quien llama siga tratando el resto de códigos.
 */
export function useApiFetch() {
  const { onSessionExpired } = useSession()
  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const res = await fetch(input, init)
      if (res.status === 401) onSessionExpired()
      return res
    },
    [onSessionExpired]
  )
}

/**
 * Misma regla que `requireAccess({screen})` en servidor y que `canAccessPanel`
 * en los navbars: pública (o sin registrar) pasa hasta sin sesión; si no, hace
 * falta sesión y que el rol esté permitido.
 */
export function puedeAcceder(cfg: ScreenConfig | undefined, user: { role: string } | null): boolean {
  if (!cfg || cfg.is_public) return true
  if (!user) return false
  return user.role === "admin" || cfg.allowed_roles.includes(user.role)
}

/**
 * Envuelve el contenido de una página. No pinta nada hasta saber si se puede
 * entrar — es lo que quita el "flash" del panel antes de rebotar al login.
 */
export function RequireAccess({ screen, children }: { screen?: string; children: React.ReactNode }) {
  const { user, screens, loading } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  const permitido = screen ? puedeAcceder(screens[screen], user) : !!user
  const debeCambiarContrasena = !!user?.mustChangePassword

  useEffect(() => {
    if (loading) return
    if (debeCambiarContrasena) { router.push("/cambiar-contrasena"); return }
    if (!permitido) router.push(loginUrlPara(pathname))
  }, [loading, permitido, debeCambiarContrasena, router, pathname])

  if (loading || debeCambiarContrasena || !permitido) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" aria-label="Comprobando sesión" />
      </div>
    )
  }
  return <>{children}</>
}
