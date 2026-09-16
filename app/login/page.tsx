"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import Image from "next/image"
import { PANELS } from "@/lib/panels"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Error al iniciar sesión")
        return
      }

      if (data.mustChangePassword) {
        router.push("/cambiar-contrasena")
        return
      }

      // Buscar el primer panel al que tiene acceso según permisos configurados
      try {
        const screensRes = await fetch('/api/screen-permissions')
        if (screensRes.ok) {
          const screens = await screensRes.json()
          const puedeAcceder = (p: typeof PANELS[number]) => {
            const cfg = screens[p.key]
            if (!cfg) return true
            return cfg.is_public || data.role === 'admin' || cfg.allowed_roles.includes(data.role)
          }

          // Si llegó aquí redirigido desde un panel (?next=/loteadora), volver a ese
          // panel en vez de al primero de la lista. Dos guardas imprescindibles: que
          // sea ruta interna (si no, es un open redirect de manual) y que de verdad
          // tenga acceso (si no, el panel le rebota al login otra vez, en bucle).
          // Se lee de window y no con useSearchParams para no tener que envolver la
          // página en <Suspense>, que es lo que pide Next al prerenderizarla.
          const next = new URLSearchParams(window.location.search).get('next')
          const destino = next && next.startsWith('/') && !next.startsWith('//')
            ? PANELS.find(p => p.href === next && puedeAcceder(p))
            : undefined
          if (destino) { router.push(destino.href); return }

          const first = PANELS.find(puedeAcceder)
          if (first) { router.push(first.href); return }
          setError("No tienes acceso a ningún panel. Contacta con el administrador.")
          return
        }
      } catch { /* si falla la comprobación, ir a producción por defecto */ }
      router.push("/produccion")
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card accent className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Image src="/logo.png" alt="Elaborados Naturales" width={180} height={63} priority />
          </div>
          <CardTitle className="text-lg font-semibold text-foreground">Iniciar Sesión</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="text-xs font-semibold text-secondary-foreground">Usuario</label>
              <Input
                id="login-username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Usuario"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-xs font-semibold text-secondary-foreground">Contraseña</label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Contraseña"
                required
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive font-medium">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full font-semibold"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
