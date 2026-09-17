"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, KeyRound } from "lucide-react"
import Image from "next/image"
import { useSession } from "@/components/SessionProvider"

export default function ChangePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // Puerta al revés que el resto de páginas: aquí solo se entra SI hay que
  // cambiar la contraseña. Por eso no usa <RequireAccess>, que manda justo aquí.
  const { user, loading: checking, refresh } = useSession()

  useEffect(() => {
    if (checking) return
    if (!user) { router.push("/login"); return }
    if (!user.mustChangePassword) router.push("/produccion")
  }, [checking, user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password.length < 4) {
      setError("La contraseña debe tener al menos 4 caracteres")
      return
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Error al cambiar contraseña")
        return
      }

      // Sin esto el provider seguiría con mustChangePassword=true y
      // <RequireAccess> devolvería a esta misma página, en bucle.
      await refresh()
      router.push("/produccion")
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  if (checking || !user || !user.mustChangePassword) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card accent className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Image src="/logo.png" alt="Elaborados Naturales" width={180} height={63} priority />
          </div>
          <CardTitle className="text-lg font-semibold text-foreground flex items-center justify-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
            Cambiar Contraseña
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">Debes establecer una nueva contraseña para continuar.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-password" className="text-xs font-semibold text-secondary-foreground">Nueva contraseña</label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Nueva contraseña"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="text-xs font-semibold text-secondary-foreground">Confirmar contraseña</label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repetir contraseña"
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
              Guardar y continuar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
