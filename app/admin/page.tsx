"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Trash2, UserPlus, ArrowLeft, KeyRound, Pencil } from "lucide-react"
import Image from "next/image"

interface User {
  id: number
  username: string
  role: string
  name: string
  surname: string
  created_at: string
}

export default function AdminPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  // Form crear usuario
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState("user")
  const [newName, setNewName] = useState("")
  const [newSurname, setNewSurname] = useState("")
  const [forceChange, setForceChange] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  // Form resetear contraseña
  const [resetUserId, setResetUserId] = useState<number | null>(null)
  const [resetPassword, setResetPassword] = useState("")

  // Form editar usuario
  const [editUserId, setEditUserId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editSurname, setEditSurname] = useState("")
  const [editUsername, setEditUsername] = useState("")
  const [editRole, setEditRole] = useState("user")
  const [editError, setEditError] = useState("")

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me")
      if (!res.ok) { router.push("/login"); return }
      const data = await res.json()
      if (data.role !== "admin") { router.push("/produccion"); return }
      setAuthorized(true)
      loadUsers()
    } catch {
      router.push("/login")
    }
  }

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/users")
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setCreating(true)

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole, mustChangePassword: forceChange, name: newName, surname: newSurname }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error)
        return
      }

      setSuccess(`Usuario "${newUsername}" creado`)
      setNewUsername("")
      setNewPassword("")
      setNewRole("user")
      setNewName("")
      setNewSurname("")
      setForceChange(true)
      loadUsers()
    } catch {
      setError("Error de conexión")
    } finally {
      setCreating(false)
    }
  }

  const deleteUser = async (id: number, username: string) => {
    if (!confirm(`¿Eliminar usuario "${username}"?`)) return

    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error)
        return
      }
      loadUsers()
    } catch {
      alert("Error al eliminar")
    }
  }

  const resetUserPassword = async (id: number) => {
    if (!resetPassword || resetPassword.length < 4) {
      alert("La contraseña debe tener al menos 4 caracteres")
      return
    }

    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error)
        return
      }
      setResetUserId(null)
      setResetPassword("")
      alert("Contraseña reseteada. El usuario deberá cambiarla al iniciar sesión.")
    } catch {
      alert("Error al resetear")
    }
  }

  const startEdit = (u: User) => {
    setEditUserId(u.id)
    setEditName(u.name || "")
    setEditSurname(u.surname || "")
    setEditUsername(u.username)
    setEditRole(u.role)
    setEditError("")
    setResetUserId(null)
  }

  const saveEdit = async () => {
    if (!editUserId) return
    setEditError("")

    try {
      const res = await fetch(`/api/admin/users/${editUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: editUsername, name: editName, surname: editSurname, role: editRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEditError(data.error)
        return
      }
      setEditUserId(null)
      loadUsers()
    } catch {
      setEditError("Error de conexión")
    }
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-3xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="Elaborados Naturales" width={120} height={42} priority />
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Panel de Administración</h1>
              <p className="text-sm text-gray-500">Gestión de usuarios</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push("/produccion")} className="text-gray-600">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al Dashboard
          </Button>
        </div>

        {/* Crear usuario */}
        <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <UserPlus className="h-4 w-4" style={{ color: '#D30B15' }} />
              Crear Usuario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700">Nombre</label>
                  <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Juan" className="w-[150px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700">Apellido</label>
                  <Input value={newSurname} onChange={e => setNewSurname(e.target.value)} placeholder="García" className="w-[150px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700">Usuario</label>
                  <Input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="jgarcia" required className="w-[150px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700">Contraseña</label>
                  <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••" required className="w-[150px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-700">Rol</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value)} className="flex h-9 w-[120px] rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm">
                    <option value="user">Usuario</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button type="submit" disabled={creating} className="text-white font-semibold" style={{ backgroundColor: '#D30B15' }}>
                  {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                  Crear
                </Button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceChange}
                  onChange={e => setForceChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-red-600"
                />
                <span className="text-sm text-gray-600">Forzar cambio de contraseña en el primer inicio de sesión</span>
              </label>
            </form>
            {error && <p className="text-sm text-red-600 font-medium mt-3">{error}</p>}
            {success && <p className="text-sm text-green-600 font-medium mt-3">{success}</p>}
          </CardContent>
        </Card>

        {/* Lista de usuarios */}
        <Card className="overflow-hidden" style={{ borderTop: '3px solid #D30B15' }}>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Usuarios Registrados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-200 hover:bg-transparent">
                    <TableHead className="font-bold text-gray-700">ID</TableHead>
                    <TableHead className="font-bold text-gray-700">Nombre</TableHead>
                    <TableHead className="font-bold text-gray-700">Usuario</TableHead>
                    <TableHead className="font-bold text-gray-700">Rol</TableHead>
                    <TableHead className="font-bold text-gray-700">Creado</TableHead>
                    <TableHead className="font-bold text-gray-700 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => (
                    editUserId === u.id ? (
                      <TableRow key={u.id} className="bg-blue-50 border-blue-200">
                        <TableCell className="text-gray-500">{u.id}</TableCell>
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
                          <select value={editRole} onChange={e => setEditRole(e.target.value)} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        </TableCell>
                        <TableCell colSpan={2}>
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={saveEdit} className="text-white text-xs font-semibold h-8" style={{ backgroundColor: '#D30B15' }}>
                              Guardar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditUserId(null)} className="text-gray-400 h-8 text-xs">
                              Cancelar
                            </Button>
                            {editError && <span className="text-xs text-red-600 font-medium">{editError}</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={u.id} className="hover:bg-slate-50 border-gray-100">
                        <TableCell className="text-gray-500">{u.id}</TableCell>
                        <TableCell className="font-medium">{u.name || u.surname ? `${u.name} ${u.surname}`.trim() : '—'}</TableCell>
                        <TableCell className="font-medium">{u.username}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                            {u.role}
                          </span>
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {new Date(u.created_at).toLocaleDateString('es-ES')}
                        </TableCell>
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
                      </TableRow>
                    )
                  ))}
                  {/* Fila inline para resetear contraseña */}
                  {resetUserId && (
                    <TableRow className="bg-amber-50 border-amber-200">
                      <TableCell colSpan={6}>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-amber-700">
                            Nueva contraseña para &quot;{users.find(u => u.id === resetUserId)?.username}&quot;:
                          </span>
                          <Input
                            type="password"
                            value={resetPassword}
                            onChange={e => setResetPassword(e.target.value)}
                            placeholder="Nueva contraseña"
                            className="h-8 w-[200px] text-sm"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && resetUserPassword(resetUserId)}
                          />
                          <Button size="sm" onClick={() => resetUserPassword(resetUserId)} className="text-white text-xs font-semibold h-8" style={{ backgroundColor: '#D30B15' }}>
                            Resetear
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setResetUserId(null); setResetPassword("") }} className="text-gray-400 h-8 text-xs">
                            Cancelar
                          </Button>
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
      </div>
    </div>
  )
}
