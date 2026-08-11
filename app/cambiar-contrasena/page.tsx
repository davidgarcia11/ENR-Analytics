"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, KeyRound } from "lucide-react"
import Image from "next/image"

export default function ChangePasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Verificar que el usuario está logueado y necesita cambiar contraseña
    fetch("/api/auth/me")
      .then(r => {
        if (!r.ok) { router.push("/login"); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        if (!data.mustChangePassword) router.push("/produccion")
        else setChecking(false)
      })
      .catch(() => router.push("/login"))
  }, [router])

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

      router.push("/produccion")
    } catch {
      setError("Error de conexión")
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
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
