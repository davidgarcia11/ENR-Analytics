"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { ConfirmDialog } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/toast"
import { Loader2, Trash2, UserPlus, ArrowLeft, KeyRound, Pencil, FileText, ShieldCheck, Tag } from "lucide-react"
import Image from "next/image"
import { PANELS } from "@/lib/panels"
import { PLANTS, plantLabel } from "@/lib/plants"

interface User {
  id: number
  username: string
  role: string
  name: string
  surname: string
  defaultPlant: string
  canConfigureMuestras: boolean
  created_at: string
}

interface Role {
  id: number
  name: string
  label: string
  created_at: string
}

interface ScreenConfig {
  is_public: boolean
  allowed_roles: string[]
}

interface Screen {
  key: string
  label: string
  path: string
  config: ScreenConfig
}

type Tab = 'usuarios' | 'roles' | 'pantallas' | 'estados-jde' | 'coste-a1-coledg' | 'muestras'

interface JdeStatus {
  code: string
  description: string
  updated_at?: string
}

interface ColedgMensual {
  mes: string
  coledg: string
  updated_at?: string
}

interface MuestrasSyncState {
  lastSyncedAt: string | null
  candidatosSincronizados: number
  error: string | null
  articulosConfigurados: number
}

// Derivado de la fuente única de paneles — nunca declarar esta lista a mano aquí.
const SCREEN_KEYS = PANELS.map(({ key, label }) => ({ key, label }))

export default function AdminPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<Tab>('usuarios')
  const [authorized, setAuthorized] = useState(false)

  // Confirmación de borrado (sustituye a confirm() nativo): guarda la acción pendiente
  const [confirmState, setConfirmState] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null)

  // ─── Usuarios ───────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState("user")
  const [newName, setNewName] = useState("")
  const [newSurname, setNewSurname] = useState("")
  const [newDefaultPlant, setNewDefaultPlant] = useState("")
  const [forceChange, setForceChange] = useState(true)
  const [creating, setCreating] = useState(false)
  const [userError, setUserError] = useState("")
  const [userSuccess, setUserSuccess] = useState("")
  const [resetUserId, setResetUserId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editSurname, setEditSurname] = useState("")
  const [editUsername, setEditUsername] = useState("")
  const [editRole, setEditRole] = useState("user")
  const [editDefaultPlant, setEditDefaultPlant] = useState("")
  const [editError, setEditError] = useState("")

  // ─── Roles ───────────────────────────────────────────────────────────────────
  const [roles, setRoles] = useState<Role[]>([])
  const [loadingRoles, setLoadingRoles] = useState(false)
  const [newRoleName, setNewRoleName] = useState("")
  const [newRoleLabel, setNewRoleLabel] = useState("")
  const [roleError, setRoleError] = useState("")
  const [roleSuccess, setRoleSuccess] = useState("")
  const [creatingRole, setCreatingRole] = useState(false)

  // ─── Pantallas ───────────────────────────────────────────────────────────────
  const [screens, setScreens] = useState<Record<string, ScreenConfig>>({})
  const [loadingScreens, setLoadingScreens] = useState(false)
  const [savingScreen, setSavingScreen] = useState<string | null>(null)
  const [screenSuccess, setScreenSuccess] = useState("")

  // ─── Estados JDE (descripciones editables de SYEDSP) ─────────────────────────
  const [jdeStatuses, setJdeStatuses] = useState<JdeStatus[]>([])
  const [loadingJdeStatuses, setLoadingJdeStatuses] = useState(false)
  // Borradores locales (lo que el admin escribe antes de guardar) y el código que estamos guardando
  const [jdeStatusDrafts, setJdeStatusDrafts] = useState<Record<string, string>>({})
  const [savingJdeStatus, setSavingJdeStatus] = useState<string | null>(null)
  const [jdeStatusSuccess, setJdeStatusSuccess] = useState("")
  const [jdeStatusError, setJdeStatusError] = useState("")

  // ─── Coste real mensual (mapeo mes -> ledger IELEDG de F30026, usado por /costes) ──
  const [coledgMensual, setColedgMensual] = useState<ColedgMensual[]>([])
  const [loadingColedgMensual, setLoadingColedgMensual] = useState(false)
  const [newMesColedg, setNewMesColedg] = useState("")
  const [newColedgCodigo, setNewColedgCodigo] = useState("")
  const [creatingColedg, setCreatingColedg] = useState(false)
  const [coledgDrafts, setColedgDrafts] = useState<Record<string, string>>({})
  const [savingColedg, setSavingColedg] = useState<string | null>(null)
  const [coledgError, setColedgError] = useState("")
  const [coledgSuccess, setColedgSuccess] = useState("")

  // ─── Muestras (sincronización manual) ─────────────────────────────────────────
  const [muestrasSync, setMuestrasSync] = useState<MuestrasSyncState | null>(null)
  const [syncingMuestras, setSyncingMuestras] = useState(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      if (data.role !== "admin") { router.push("/produccion"); return }
      setAuthorized(true)
      loadUsers()
      loadRoles()
      loadScreens()
      loadJdeStatuses()
      loadColedgMensual()
      loadMuestrasSync()
    } catch {
      router.push("/login")
    }
  }

  // ─── Carga de datos ──────────────────────────────────────────────────────────

  const loadUsers = async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch("/api/admin/users")
      if (res.ok) setUsers(await res.json())
    } finally { setLoadingUsers(false) }
  }

  const loadRoles = async () => {
    setLoadingRoles(true)
    try {
      const res = await fetch("/api/admin/roles")
      if (res.ok) setRoles(await res.json())
    } finally { setLoadingRoles(false) }
  }

  const loadMuestrasSync = async () => {
    try {
      const res = await fetch("/api/admin/muestras-sync")
      if (res.ok) setMuestrasSync(await res.json())
    } catch { /* silencioso */ }
  }

  // La sincronización real se dispara sola (al cambiar la lista de artículos y cada
  // 30 min de fondo, ver lib/muestras.ts) — este botón es solo un "hazlo ya", y como
  // ya no va por tramos, la petición termina cuando termina de verdad (sin polling).
  const syncMuestrasNow = async () => {
    setSyncingMuestras(true)
    try {
      const res = await fetch("/api/admin/muestras-sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast(data.error || "Error al sincronizar", "error"); return }
      toast(`Sincronizado — ${data.rows} lotes traídos`, "success")
      loadMuestrasSync()
    } catch {
      toast("Error al sincronizar", "error")
    } finally {
      setSyncingMuestras(false)
    }
  }

  const loadScreens = async () => {
    setLoadingScreens(true)
    try {
      const res = await fetch("/api/screen-permissions")
      if (res.ok) setScreens(await res.json())
    } finally { setLoadingScreens(false) }
  }

  const loadJdeStatuses = async () => {
    setLoadingJdeStatuses(true)
    try {
      const res = await fetch("/api/admin/jde-statuses")
      if (res.ok) {
        const data: JdeStatus[] = await res.json()
        setJdeStatuses(data)
        const drafts: Record<string, string> = {}
        data.forEach(s => { drafts[s.code] = s.description })
        setJdeStatusDrafts(drafts)
      }
    } finally { setLoadingJdeStatuses(false) }
  }

  const saveJdeStatus = async (code: string) => {
    const description = (jdeStatusDrafts[code] ?? '').trim()
    if (!description) {
      setJdeStatusError(`La descripción de ${code} no puede estar vacía`)
      return
    }
    setJdeStatusError(""); setJdeStatusSuccess(""); setSavingJdeStatus(code)
    try {
      const res = await fetch(`/api/admin/jde-statuses/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      const data = await res.json()
      if (!res.ok) { setJdeStatusError(data.error || 'Error al guardar'); return }
      setJdeStatusSuccess(`Descripción de "${code}" guardada`)
      loadJdeStatuses()
    } catch {
      setJdeStatusError('Error de conexión')
    } finally {
      setSavingJdeStatus(null)
    }
  }

  const loadColedgMensual = async () => {
    setLoadingColedgMensual(true)
    try {
      const res = await fetch("/api/admin/coste-a1-coledg")
      if (res.ok) {
        const data: ColedgMensual[] = await res.json()
        setColedgMensual(data)
        const drafts: Record<string, string> = {}
        data.forEach(c => { drafts[c.mes] = c.coledg })
        setColedgDrafts(drafts)
      }
    } finally { setLoadingColedgMensual(false) }
  }

  const createColedgMensual = async (e: React.FormEvent) => {
    e.preventDefault()
    setColedgError(""); setColedgSuccess(""); setCreatingColedg(true)
    try {
      const res = await fetch("/api/admin/coste-a1-coledg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: newMesColedg, coledg: newColedgCodigo }),
      })
      const data = await res.json()
      if (!res.ok) { setColedgError(data.error); return }
      setColedgSuccess(`Mes "${newMesColedg}" añadido con código "${newColedgCodigo.toUpperCase()}"`)
      setNewMesColedg(""); setNewColedgCodigo("")
      loadColedgMensual()
    } catch { setColedgError("Error de conexión") } finally { setCreatingColedg(false) }
  }

  const saveColedgMensual = async (mes: string) => {
    const coledg = (coledgDrafts[mes] ?? '').trim()
    if (!coledg) {
      setColedgError(`El código de ${mes} no puede estar vacío`)
      return
    }
    setColedgError(""); setColedgSuccess(""); setSavingColedg(mes)
    try {
      const res = await fetch(`/api/admin/coste-a1-coledg/${encodeURIComponent(mes)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coledg }),
      })
      const data = await res.json()
      if (!res.ok) { setColedgError(data.error || 'Error al guardar'); return }
      setColedgSuccess(`Código de "${mes}" guardado`)
      loadColedgMensual()
    } catch {
      setColedgError('Error de conexión')
    } finally {
      setSavingColedg(null)
    }
  }

  const deleteColedgMensual = (mes: string) => {
    setConfirmState({
      title: "Eliminar mapeo de mes",
      description: `Se eliminará el código IELEDG configurado para "${mes}". El coste real de /costes dejará de tener dato para ese mes hasta que se vuelva a configurar.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/coste-a1-coledg/${encodeURIComponent(mes)}`, { method: "DELETE" })
          const data = await res.json()
          if (!res.ok) { toast(data.error || "Error al eliminar", "error"); return }
          loadColedgMensual()
          toast(`Mes "${mes}" eliminado`, "success")
        } catch { toast("Error al eliminar", "error") }
      },
    })
  }

  // ─── Acciones de usuarios ────────────────────────────────────────────────────

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setUserError(""); setUserSuccess(""); setCreating(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole, mustChangePassword: forceChange, name: newName, surname: newSurname, defaultPlant: newDefaultPlant }),
      })
      const data = await res.json()
      if (!res.ok) { setUserError(data.error); return }
      setUserSuccess(`Usuario "${newUsername}" creado`)
      setNewUsername(""); setNewPassword(""); setNewRole("user"); setNewName(""); setNewSurname(""); setNewDefaultPlant(""); setForceChange(true)
      loadUsers()
    } catch { setUserError("Error de conexión") } finally { setCreating(false) }
  }

  // Lanza la confirmación; el borrado real corre al confirmar en el ConfirmDialog
  const deleteUser = (id: number, username: string) => {
    setConfirmState({
      title: "Eliminar usuario",
      description: `Se eliminará el usuario "${username}". Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" })
          const data = await res.json()
          if (!res.ok) { toast(data.error || "Error al eliminar", "error"); return }
          loadUsers()
          toast(`Usuario "${username}" eliminado`, "success")
        } catch { toast("Error al eliminar", "error") }
      },
    })
  }

  const resetUserPassword = async (id: number) => {
    if (!resetPassword || resetPassword.length < 4) { toast("La contraseña debe tener al menos 4 caracteres", "error"); return }
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || "Error al resetear", "error"); return }
      setResetUserId(null); setResetPassword("")
      toast("Contraseña reseteada. El usuario deberá cambiarla al iniciar sesión.", "success")
    } catch { toast("Error al resetear", "error") }
  }

  // Permiso suelto (no un rol): quién puede editar la lista de artículos de /muestras
  // además de admin. Se alterna con un solo clic, sin entrar en modo edición del resto
  // de datos del usuario — ver docs/muestras.md.
  const toggleMuestrasConfig = async (u: User) => {
    try {
      const res = await fetch(`/api/admin/users/${u.id}/muestras-config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !u.canConfigureMuestras }),
      })
      if (!res.ok) { toast("Error al actualizar el permiso", "error"); return }
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, canConfigureMuestras: !u.canConfigureMuestras } : x))
    } catch { toast("Error al actualizar el permiso", "error") }
  }

  const startEdit = (u: User) => {
    setEditUserId(u.id); setEditName(u.name || ""); setEditSurname(u.surname || "")
    setEditUsername(u.username); setEditRole(u.role); setEditDefaultPlant(u.defaultPlant || "")
    setEditError(""); setResetUserId(null)
  }

  const saveEdit = async () => {
    if (!editUserId) return
    setEditError("")
    try {
      const res = await fetch(`/api/admin/users/${editUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: editUsername, name: editName, surname: editSurname, role: editRole, defaultPlant: editDefaultPlant }),
      })
      const data = await res.json()
      if (!res.ok) { setEditError(data.error); return }
      setEditUserId(null); loadUsers()
    } catch { setEditError("Error de conexión") }
  }

  // ─── Acciones de roles ───────────────────────────────────────────────────────

  const createRole = async (e: React.FormEvent) => {
    e.preventDefault()
    setRoleError(""); setRoleSuccess(""); setCreatingRole(true)
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRoleName, label: newRoleLabel }),
      })
      const data = await res.json()
      if (!res.ok) { setRoleError(data.error); return }
      setRoleSuccess(`Rol "${newRoleLabel}" creado`)
      setNewRoleName(""); setNewRoleLabel("")
      loadRoles()
    } catch { setRoleError("Error de conexión") } finally { setCreatingRole(false) }
  }

  const deleteRole = (id: number, name: string, label: string) => {
    setConfirmState({
      title: "Eliminar rol",
      description: `Se eliminará el rol "${label}". Los usuarios con ese rol pasarán a "user".`,
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/roles/${id}`, { method: "DELETE" })
          const data = await res.json()
          if (!res.ok) { toast(data.error || "Error al eliminar el rol", "error"); return }
          loadRoles(); loadUsers()
          toast(`Rol "${label}" eliminado`, "success")
        } catch { toast("Error al eliminar el rol", "error") }
      },
    })
  }

  // ─── Acciones de pantallas ───────────────────────────────────────────────────

  const toggleScreenPublic = (key: string, isPublic: boolean) => {
    setScreens(prev => ({ ...prev, [key]: { ...prev[key], is_public: isPublic } }))
  }

  const toggleScreenRole = (key: string, roleName: string, checked: boolean) => {
    setScreens(prev => {
      const current = prev[key]?.allowed_roles ?? []
      const updated = checked ? [...current, roleName] : current.filter(r => r !== roleName)
      return { ...prev, [key]: { ...prev[key], allowed_roles: updated } }
    })
  }

  const saveScreen = async (key: string) => {
    setSavingScreen(key); setScreenSuccess("")
    try {
      const config = screens[key]
      const res = await fetch(`/api/admin/screens/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: config.is_public, allowed_roles: config.allowed_roles }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || "Error al guardar", "error"); return }
      setScreenSuccess(`Pantalla guardada correctamente`)
      setTimeout(() => setScreenSuccess(""), 3000)
    } catch { toast("Error al guardar", "error") } finally { setSavingScreen(null) }
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Panel de Administración</h1>
              <p className="text-sm text-muted-foreground">Gestión de usuarios, roles y accesos</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/admin/logs")} className="text-secondary-foreground">
              <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
              Logs
            </Button>
            <Button variant="outline" onClick={() => router.push("/produccion")} className="text-secondary-foreground">
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              Dashboard
            </Button>
          </div>
        </div>

        {/* Pestañas */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as Tab)}
          tabs={[
            { value: 'usuarios', label: 'Usuarios' },
            { value: 'roles', label: 'Roles' },
            { value: 'pantallas', label: 'Pantallas' },
            { value: 'estados-jde', label: 'Estados JDE' },
            { value: 'coste-a1-coledg', label: 'Coste real (Costes)' },
            { value: 'muestras', label: 'Muestras' },
          ]}
        />

        {/* ── Pestaña Usuarios ─────────────────────────────────────────────────── */}
        {activeTab === 'usuarios' && (
          <>
            {/* Crear usuario */}
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />
                  Crear Usuario
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={createUser} className="space-y-4">
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Nombre</label>
                      <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Juan" className="w-[150px]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Apellido</label>
                      <Input value={newSurname} onChange={e => setNewSurname(e.target.value)} placeholder="García" className="w-[150px]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Usuario</label>
                      <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="jgarcia" required className="w-[150px]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Contraseña</label>
                      <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••" required className="w-[150px]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Rol</label>
                      <select value={newRole} onChange={e => setNewRole(e.target.value)} className="flex h-9 w-[140px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm">
                        {roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-secondary-foreground">Planta por defecto</label>
                      <select value={newDefaultPlant} onChange={e => setNewDefaultPlant(e.target.value)} className="flex h-9 w-[150px] rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm">
                        <option value="">Todas</option>
                        {PLANTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    <Button type="submit" disabled={creating} className="font-semibold">
                      {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                      Crear
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={forceChange} onChange={e => setForceChange(e.target.checked)} className="h-4 w-4 rounded border-input accent-primary" />
                    <span className="text-sm text-secondary-foreground">Forzar cambio de contraseña en el primer inicio de sesión</span>
                  </label>
                </form>
                {userError && <p className="text-sm text-red-600 font-medium mt-3">{userError}</p>}
                {userSuccess && <p className="text-sm text-green-600 font-medium mt-3">{userSuccess}</p>}
              </CardContent>
            </Card>

            {/* Lista de usuarios */}
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground">Usuarios Registrados</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingUsers ? (
                  <Spinner label="Cargando..." className="py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-bold text-secondary-foreground">ID</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Nombre</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Usuario</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Rol</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Planta</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Creado</TableHead>
                        <TableHead className="font-bold text-secondary-foreground text-right">Acciones</TableHead>
                        <TableHead className="font-bold text-secondary-foreground text-center" title="Puede editar la lista de artículos visibles en /muestras, además de admin">Responsable Muestras</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map(u => (
                        editUserId === u.id ? (
                          <TableRow key={u.id} className="bg-blue-50 border-blue-200">
                            <TableCell className="text-muted-foreground">{u.id}</TableCell>
                            <TableCell>
                              <div className="flex gap-1.5">
                                <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nombre" className="h-8 w-[100px] text-sm" autoFocus />
                                <Input value={editSurname} onChange={e => setEditSurname(e.target.value)} placeholder="Apellido" className="h-8 w-[100px] text-sm" />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input value={editUsername} onChange={e => setEditUsername(e.target.value)} placeholder="Usuario" className="h-8 w-[120px] text-sm" onKeyDown={e => e.key === 'Enter' && saveEdit()} />
                            </TableCell>
                            <TableCell>
                              <select value={editRole} onChange={e => setEditRole(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
                                {roles.map(r => <option key={r.name} value={r.name}>{r.label}</option>)}
                              </select>
                            </TableCell>
                            <TableCell>
                              <select value={editDefaultPlant} onChange={e => setEditDefaultPlant(e.target.value)} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
                                <option value="">Todas</option>
                                {PLANTS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                              </select>
                            </TableCell>
                            <TableCell colSpan={3}>
                              <div className="flex items-center gap-2">
                                <Button size="sm" onClick={saveEdit} className="text-xs font-semibold h-8">Guardar</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditUserId(null)} className="text-muted-foreground h-8 text-xs">Cancelar</Button>
                                {editError && <span className="text-xs text-red-600 font-medium">{editError}</span>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : (
                          <TableRow key={u.id} className="hover:bg-muted/50 border-border">
                            <TableCell className="text-muted-foreground">{u.id}</TableCell>
                            <TableCell className="font-medium">{u.name || u.surname ? `${u.name} ${u.surname}`.trim() : '—'}</TableCell>
                            <TableCell className="font-medium">{u.username}</TableCell>
                            <TableCell>
                              <Badge variant={u.role === 'admin' ? 'primary' : 'default'}>
                                {roles.find(r => r.name === u.role)?.label ?? u.role}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">{plantLabel(u.defaultPlant) || 'Todas'}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{new Date(u.created_at).toLocaleDateString('es-ES')}</TableCell>
                            <TableCell className="text-right space-x-1">
                              <Button variant="ghost" size="sm" onClick={() => startEdit(u)} className="text-blue-500 hover:text-blue-700 hover:bg-blue-50" title="Editar usuario">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setResetUserId(resetUserId === u.id ? null : u.id); setResetPassword(""); setEditUserId(null) }} className="text-amber-500 hover:text-amber-700 hover:bg-amber-50" title="Resetear contraseña">
                                <KeyRound className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => deleteUser(u.id, u.username)} className="text-red-500 hover:text-red-700 hover:bg-red-50" title="Eliminar usuario">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                            <TableCell className="text-center">
                              <input
                                type="checkbox"
                                checked={u.role === 'admin' ? true : u.canConfigureMuestras}
                                disabled={u.role === 'admin'}
                                onChange={() => toggleMuestrasConfig(u)}
                                className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                                title={u.role === 'admin' ? 'admin siempre puede configurar /muestras' : 'Puede editar la lista de artículos de /muestras'}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      ))}
                      {resetUserId && (
                        <TableRow className="bg-amber-50 border-amber-200">
                          <TableCell colSpan={8}>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium text-amber-700">Nueva contraseña para &quot;{users.find(u => u.id === resetUserId)?.username}&quot;:</span>
                              <Input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Nueva contraseña" className="h-8 w-[200px] text-sm" autoFocus onKeyDown={e => e.key === 'Enter' && resetUserPassword(resetUserId)} />
                              <Button size="sm" onClick={() => resetUserPassword(resetUserId)} className="text-xs font-semibold h-8">Resetear</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setResetUserId(null); setResetPassword("") }} className="text-muted-foreground h-8 text-xs">Cancelar</Button>
                            </div>
                            <p className="text-xs text-amber-600 mt-1">El usuario deberá cambiar la contraseña al iniciar sesión.</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Pestaña Roles ─────────────────────────────────────────────────────── */}
        {activeTab === 'roles' && (
          <>
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  Crear Rol
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={createRole} className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary-foreground">
                      Nombre interno <span className="font-normal text-muted-foreground">(letras, números, _)</span>
                    </label>
                    <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="supervisor" required className="w-[200px]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary-foreground">Etiqueta visible</label>
                    <Input value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} placeholder="Supervisor" required className="w-[160px]" />
                  </div>
                  <Button type="submit" disabled={creatingRole} className="font-semibold">
                    {creatingRole ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Crear rol
                  </Button>
                </form>
                {roleError && <p className="text-sm text-red-600 font-medium mt-3">{roleError}</p>}
                {roleSuccess && <p className="text-sm text-green-600 font-medium mt-3">{roleSuccess}</p>}
              </CardContent>
            </Card>

            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground">Roles Registrados</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingRoles ? (
                  <Spinner label="Cargando..." className="py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-bold text-secondary-foreground">ID</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Nombre interno</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Etiqueta</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Creado</TableHead>
                        <TableHead className="font-bold text-secondary-foreground text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {roles.map(r => (
                        <TableRow key={r.id} className="hover:bg-muted/50 border-border">
                          <TableCell className="text-muted-foreground">{r.id}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.name}</code>
                          </TableCell>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{new Date(r.created_at).toLocaleDateString('es-ES')}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost" size="sm"
                              disabled={r.name === 'admin'}
                              onClick={() => deleteRole(r.id, r.name, r.label)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 disabled:opacity-30"
                              title={r.name === 'admin' ? 'El rol admin no se puede eliminar' : 'Eliminar rol'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Pestaña Pantallas ─────────────────────────────────────────────────── */}
        {activeTab === 'pantallas' && (
          <div className="space-y-4">
            {screenSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2 rounded-md">{screenSuccess}</div>
            )}

            {loadingScreens ? (
              <Spinner label="Cargando..." className="py-12" />
            ) : (
              SCREEN_KEYS.map(({ key, label }) => {
                const config = screens[key]
                if (!config) return null
                return (
                  <Card key={key} accent>
                    <CardContent className="pt-5">
                      <div className="flex flex-wrap items-start gap-6">
                        <div className="min-w-[140px]">
                          <p className="text-sm font-semibold text-foreground mb-3">{label}</p>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                name={`access-${key}`}
                                checked={config.is_public}
                                onChange={() => toggleScreenPublic(key, true)}
                                className="accent-green-600"
                              />
                              <span className="text-green-700 font-medium">Pública</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer text-sm">
                              <input
                                type="radio"
                                name={`access-${key}`}
                                checked={!config.is_public}
                                onChange={() => toggleScreenPublic(key, false)}
                                className="accent-red-600"
                              />
                              <span className="text-red-700 font-medium">Restringida</span>
                            </label>
                          </div>
                        </div>

                        {!config.is_public && (
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-secondary-foreground mb-2">Roles con acceso:</p>
                            <div className="flex flex-wrap gap-3">
                              {roles.map(role => (
                                <label key={role.name} className="flex items-center gap-1.5 cursor-pointer text-sm">
                                  <input
                                    type="checkbox"
                                    checked={config.allowed_roles.includes(role.name)}
                                    disabled={role.name === 'admin'}
                                    onChange={e => toggleScreenRole(key, role.name, e.target.checked)}
                                    className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                                  />
                                  <span className={role.name === 'admin' ? 'text-muted-foreground' : 'text-secondary-foreground'}>
                                    {role.label}
                                    {role.name === 'admin' && <span className="text-xs text-muted-foreground ml-1">(siempre)</span>}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        <Button
                          size="sm"
                          onClick={() => saveScreen(key)}
                          disabled={savingScreen === key}
                          className="font-semibold self-end"
                        >
                          {savingScreen === key ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        )}

        {/* ── Pestaña Estados JDE ──────────────────────────────────────────────
            Descripciones editables de los códigos SYEDSP (F47011).
            Se muestran en /comparativa-seres (badge tooltip, columna Descripción y Excel). */}
        {activeTab === 'estados-jde' && (
          <div className="space-y-4">
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
                  Descripciones de estados JDE (F47011.SYEDSP)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Estas descripciones aparecen en el panel <strong>Comparativa SERES</strong>: en el tooltip del badge de estado, en la columna &quot;Descripción&quot; de las pestañas con datos JDE, y en la exportación a Excel.
                </p>

                {jdeStatusSuccess && (
                  <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2 rounded-md mb-3">{jdeStatusSuccess}</div>
                )}
                {jdeStatusError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-md mb-3">{jdeStatusError}</div>
                )}

                {loadingJdeStatuses ? (
                  <Spinner label="Cargando..." className="py-12" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-bold text-secondary-foreground w-24 text-center">Código</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Descripción</TableHead>
                        <TableHead className="font-bold text-secondary-foreground w-32 text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jdeStatuses.map(s => (
                        <TableRow key={s.code} className="hover:bg-muted/50 border-border">
                          <TableCell className="text-center">
                            <span className="font-mono font-bold text-foreground bg-muted px-2 py-1 rounded">{s.code}</span>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={jdeStatusDrafts[s.code] ?? ''}
                              onChange={e => setJdeStatusDrafts(d => ({ ...d, [s.code]: e.target.value }))}
                              className="h-9 text-sm"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              onClick={() => saveJdeStatus(s.code)}
                              disabled={savingJdeStatus === s.code || (jdeStatusDrafts[s.code] ?? '').trim() === s.description}
                              className="font-semibold"
                            >
                              {savingJdeStatus === s.code ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Pestaña Coste real (Costes) ────────────────────────────────────
            Mapeo mes -> código de ledger IELEDG de F30026 (coste real mensual,
            JDE) — MISMA tabla que el coste teórico A1, mismo IECOST='A1', solo
            cambia el ledger ('07' fijo para el teórico, uno por mes aquí). JDE
            genera un código nuevo cada mes sin patrón previsible (mismo caso
            que COLEDG_VIGENTE en /compras, aquí mensual) — se añade a mano
            aquí cada vez que aparezca un mes nuevo. Usado por /api/costes
            para el "Coste Real" ponderado por producción. Corregido — antes
            decía "COLEDG de F4105": esa tabla da el coste total del ledger
            (Material + Mano de obra + Amortización...), no solo el
            componente A1/Material que hace comparable la desviación. */}
        {activeTab === 'coste-a1-coledg' && (
          <div className="space-y-4">
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" aria-hidden="true" />
                  Añadir mes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Cada mes JDE genera un código de ledger <strong>IELEDG</strong> nuevo en F30026 con el coste real de ese mes (ej. &quot;6M&quot; = enero 2026). No hay fórmula fija — hay que consultar F30026 (mismo <strong>IECOST=&apos;A1&apos;</strong> que el coste teórico, solo cambia el ledger) y añadir aquí el código que le corresponda a cada mes nuevo para que <strong>Costes</strong> pueda calcular el coste real.
                </p>
                <form onSubmit={createColedgMensual} className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary-foreground">Mes</label>
                    <Input type="month" value={newMesColedg} onChange={e => setNewMesColedg(e.target.value)} required className="w-[160px]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-secondary-foreground">
                      Código IELEDG <span className="font-normal text-muted-foreground">(F30026)</span>
                    </label>
                    <Input value={newColedgCodigo} onChange={e => setNewColedgCodigo(e.target.value)} placeholder="6M" required className="w-[120px] uppercase" />
                  </div>
                  <Button type="submit" disabled={creatingColedg} className="font-semibold">
                    {creatingColedg ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Tag className="mr-2 h-4 w-4" />}
                    Añadir
                  </Button>
                </form>
                {coledgError && <p className="text-sm text-red-600 font-medium mt-3">{coledgError}</p>}
                {coledgSuccess && <p className="text-sm text-green-600 font-medium mt-3">{coledgSuccess}</p>}
              </CardContent>
            </Card>

            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground">Meses configurados</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingColedgMensual ? (
                  <Spinner label="Cargando..." className="py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-bold text-secondary-foreground w-32">Mes</TableHead>
                        <TableHead className="font-bold text-secondary-foreground">Código IELEDG</TableHead>
                        <TableHead className="font-bold text-secondary-foreground w-40 text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coledgMensual.map(c => (
                        <TableRow key={c.mes} className="hover:bg-muted/50 border-border">
                          <TableCell>
                            <span className="font-mono font-bold text-foreground bg-muted px-2 py-1 rounded">{c.mes}</span>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={coledgDrafts[c.mes] ?? ''}
                              onChange={e => setColedgDrafts(d => ({ ...d, [c.mes]: e.target.value.toUpperCase() }))}
                              className="h-9 text-sm w-28"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={() => saveColedgMensual(c.mes)}
                                disabled={savingColedg === c.mes || (coledgDrafts[c.mes] ?? '').trim() === c.coledg}
                                className="font-semibold"
                              >
                                {savingColedg === c.mes ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => deleteColedgMensual(c.mes)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Eliminar mes"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {coledgMensual.length === 0 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">
                            Ningún mes configurado todavía.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Pestaña Muestras (sincronización de la caché de /muestras) ────────
            El panel /muestras nunca consulta Oracle en directo — lee de sample_candidates
            (SQLite), que se sincroniza sola al cambiar la lista de artículos visibles y
            cada 30 min de fondo. Este botón solo fuerza esa misma sincronización ya
            mismo. Ver docs/muestras.md. */}
        {activeTab === 'muestras' && (
          <div className="space-y-4">
            <Card accent>
              <CardHeader>
                <CardTitle className="text-sm font-bold text-secondary-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                  Sincronización de Muestras
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  El panel <strong>/muestras</strong> se sincroniza solo: al cambiar la lista de &quot;Artículos visibles&quot;
                  y cada 30 minutos de fondo. Este botón solo sirve para forzarlo ahora mismo.
                </p>

                {!muestrasSync ? (
                  <Spinner label="Cargando estado..." className="py-4" />
                ) : muestrasSync.articulosConfigurados === 0 ? (
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">Sin artículos configurados</Badge>
                    <span className="text-sm text-muted-foreground">
                      Añade al menos uno en &quot;Artículos visibles&quot; (dentro de /muestras) para que haya algo que sincronizar.
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={muestrasSync.error ? 'destructive' : muestrasSync.lastSyncedAt ? 'success' : 'outline'}>
                      {muestrasSync.error ? 'Error' : muestrasSync.lastSyncedAt ? 'Al día' : 'Sin sincronizar todavía'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {muestrasSync.articulosConfigurados} artículo{muestrasSync.articulosConfigurados === 1 ? '' : 's'} configurado{muestrasSync.articulosConfigurados === 1 ? '' : 's'}
                      {muestrasSync.lastSyncedAt && ` · última sincronización: ${new Date(muestrasSync.lastSyncedAt).toLocaleString('es-ES')} · ${muestrasSync.candidatosSincronizados.toLocaleString('es-ES')} lotes`}
                    </span>
                    {muestrasSync.error && <span className="text-sm text-red-600">{muestrasSync.error}</span>}

                    <Button size="sm" onClick={syncMuestrasNow} disabled={syncingMuestras} className="font-semibold ml-auto">
                      {syncingMuestras ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Sincronizar ahora
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

      </div>

      {/* Confirmación de acciones destructivas (borrar usuario / rol) */}
      <ConfirmDialog
        open={confirmState !== null}
        onOpenChange={o => !o && setConfirmState(null)}
        title={confirmState?.title ?? ""}
        description={confirmState?.description}
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => confirmState?.onConfirm()}
      />
    </div>
  )
}
