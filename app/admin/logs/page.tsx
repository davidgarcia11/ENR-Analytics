"use client"

// Los logs viven ahora dentro de /admin (Datos › Logs de consultas y Confirmaciones
// PDA, ver components/nova/admin/logs-consultas.tsx y confirmaciones-pda.tsx). Esta
// ruta se mantiene para que no se rompan los enlaces existentes: solo redirige.
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { RequireAccess } from "@/components/SessionProvider"

function IrALogs() {
  const router = useRouter()
  useEffect(() => { router.replace("/admin?seccion=logs") }, [router])
  return null
}

export default function LogsPage() {
  return (
    <RequireAccess role="admin">
      <IrALogs />
    </RequireAccess>
  )
}
