"use client";

// /admin → Usuarios, sobre Nova. Tabla con menú de acciones por fila, alta/edición/
// reseteo/borrado en diálogos, y un panel lateral de "Accesos" (clic en la fila) que
// responde de un vistazo qué ve y qué puede configurar un usuario: lo que le da su rol
// (matriz de "Roles y permisos") más sus permisos extra, que se activan aquí mismo.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, KeyRound, Loader2, Lock, MoreHorizontal, Pencil, Trash2, UserPlus } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { iniciales } from "@/components/shadcn-space/blocks/topbar-02/header/dropdown-profile";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Switch } from "@/components/nova/ui/switch";
import { Avatar, AvatarFallback } from "@/components/nova/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/nova/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import { PANELS } from "@/lib/panels";
import { LISTA_PERMISOS, PERMISOS, type Permiso } from "@/lib/permisos";
import { PLANTS, plantLabel } from "@/lib/plants";
import { Buscador, CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Usuario {
  id: number;
  username: string;
  role: string;
  name: string;
  surname: string;
  defaultPlant: string;
  /** Solo los extras del usuario (user_permissions); los del rol vienen en Rol.permisos */
  permisos: string[];
  created_at: string;
}

interface Rol {
  id: number;
  name: string;
  label: string;
  permisos: string[];
}

interface ScreenConfig {
  is_public: boolean;
  allowed_roles: string[];
}

// Base UI Select no distingue "" de "sin valor": la planta "todas" viaja como "" a
// la API, pero en el desplegable necesita un valor propio.
const TODAS = "todas";
const PLANT_ITEMS = [{ value: TODAS, label: "Todas" }, ...PLANTS.map((p) => ({ value: p.id, label: p.label }))];

interface DatosUsuario {
  name: string;
  surname: string;
  username: string;
  role: string;
  defaultPlant: string;
}

const VACIO: DatosUsuario = { name: "", surname: "", username: "", role: "user", defaultPlant: "" };

function nombreCompleto(u: Pick<Usuario, "name" | "surname" | "username">) {
  return u.name || u.surname ? `${u.name} ${u.surname}`.trim() : u.username;
}

// Campos compartidos por los diálogos de alta y edición.
function CamposUsuario({ datos, onChange, roles }: {
  datos: DatosUsuario;
  onChange: (d: DatosUsuario) => void;
  roles: Rol[];
}) {
  const roleItems = roles.map((r) => ({ value: r.name, label: r.label }));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor="u-nombre">Nombre</Label>
        <Input id="u-nombre" value={datos.name} onChange={(e) => onChange({ ...datos, name: e.target.value })} placeholder="Juan" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="u-apellido">Apellido</Label>
        <Input id="u-apellido" value={datos.surname} onChange={(e) => onChange({ ...datos, surname: e.target.value })} placeholder="García" />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="u-usuario">Usuario</Label>
        <Input id="u-usuario" value={datos.username} onChange={(e) => onChange({ ...datos, username: e.target.value })} placeholder="jgarcia" autoComplete="off" />
      </div>
      <div className="grid gap-2">
        <Label>Rol</Label>
        <Select items={roleItems} value={datos.role} onValueChange={(v) => onChange({ ...datos, role: v as string })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {roleItems.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Planta por defecto</Label>
        <Select
          items={PLANT_ITEMS}
          value={datos.defaultPlant || TODAS}
          onValueChange={(v) => onChange({ ...datos, defaultPlant: v === TODAS ? "" : (v as string) })}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PLANT_ITEMS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default function AdminUsuarios({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [pantallas, setPantallas] = useState<Record<string, ScreenConfig>>({});
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState<DatosUsuario>(VACIO);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [forzarCambio, setForzarCambio] = useState(true);

  const [editando, setEditando] = useState<Usuario | null>(null);
  const [edicion, setEdicion] = useState<DatosUsuario>(VACIO);
  const [reseteando, setReseteando] = useState<Usuario | null>(null);
  const [passwordReset, setPasswordReset] = useState("");
  const [accesosDe, setAccesosDe] = useState<number | null>(null);
  const [borrando, setBorrando] = useState<Usuario | null>(null);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = async () => {
    try {
      const [resU, resR, resS] = await Promise.all([
        apiFetch("/api/admin/users"), apiFetch("/api/admin/roles"), apiFetch("/api/screen-permissions"),
      ]);
      if (resU.ok) setUsuarios(await resU.json());
      if (resR.ok) setRoles(await resR.json());
      if (resS.ok) setPantallas(await resS.json());
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((u) => `${u.name} ${u.surname} ${u.username}`.toLowerCase().includes(q));
  }, [usuarios, busqueda]);

  const rolDe = (name: string) => roles.find((r) => r.name === name);
  const rolLabel = (name: string) => rolDe(name)?.label ?? name;
  const permisosDelRol = (name: string) => rolDe(name)?.permisos ?? [];
  const accesos = usuarios.find((u) => u.id === accesosDe) ?? null;

  // Paneles que ve un usuario: públicos, los de su rol, o todos si es admin (misma
  // regla que accesoPantalla en lib/permissions.ts).
  const panelesQueVe = (u: Usuario) =>
    PANELS.filter((p) => {
      const cfg = pantallas[p.key];
      return !cfg || cfg.is_public || u.role === "admin" || cfg.allowed_roles.includes(u.role);
    });

  const cerrarDialogos = () => {
    setCreando(false); setEditando(null); setReseteando(null); setBorrando(null);
    setError(""); setGuardando(false);
  };

  // ─── Acciones (mismas rutas que la versión anterior) ─────────────────────────

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...nuevo, password: nuevaPassword, mustChangePassword: forzarCambio }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al crear el usuario"); return; }
      toast.success(`Usuario "${nuevo.username}" creado`);
      setNuevo(VACIO); setNuevaPassword(""); setForzarCambio(true);
      cerrarDialogos();
      cargar();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const abrirEdicion = (u: Usuario) => {
    setEdicion({ name: u.name || "", surname: u.surname || "", username: u.username, role: u.role, defaultPlant: u.defaultPlant || "" });
    setError("");
    setEditando(u);
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editando) return;
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/users/${editando.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edicion),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al guardar"); return; }
      toast.success(`Usuario "${edicion.username}" actualizado`);
      cerrarDialogos();
      cargar();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const abrirReseteo = (u: Usuario) => { setPasswordReset(""); setError(""); setReseteando(u); };

  const resetear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reseteando) return;
    if (passwordReset.length < 4) { setError("La contraseña debe tener al menos 4 caracteres"); return; }
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/users/${reseteando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordReset }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al resetear"); return; }
      toast.success("Contraseña reseteada. El usuario deberá cambiarla al iniciar sesión.");
      cerrarDialogos();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  // Permiso extra (excepción individual, además de lo de su rol). Se guarda al momento.
  const togglePermisoExtra = async (u: Usuario, permiso: Permiso) => {
    const enabled = !u.permisos.includes(permiso);
    try {
      const res = await apiFetch(`/api/admin/users/${u.id}/permisos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permiso, enabled }),
      });
      if (!res.ok) { toast.error("Error al actualizar el permiso"); return; }
      setUsuarios((prev) => prev.map((x) => (x.id !== u.id ? x : {
        ...x, permisos: enabled ? [...x.permisos, permiso] : x.permisos.filter((p) => p !== permiso),
      })));
    } catch { toast.error("Error al actualizar el permiso"); }
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/users/${borrando.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al eliminar"); return; }
      toast.success(`Usuario "${borrando.username}" eliminado`);
      cerrarDialogos();
      cargar();
    } catch { toast.error("Error al eliminar"); } finally { setGuardando(false); }
  };

  // Badges de la tabla: permisos efectivos (rol + extras); los extras, rellenos.
  const badgesPermisos = (u: Usuario) => {
    if (u.role === "admin") return <span className="text-xs text-muted-foreground">Todos</span>;
    const delRol = permisosDelRol(u.role);
    const efectivos = LISTA_PERMISOS.filter((p) => delRol.includes(p) || u.permisos.includes(p));
    if (efectivos.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {efectivos.map((p) => {
          const extra = !delRol.includes(p);
          return (
            <Badge key={p} variant={extra ? "secondary" : "outline"} title={`${PERMISOS[p].label} · ${extra ? "extra de este usuario" : "por su rol"}`}>
              {PERMISOS[p].corto}
            </Badge>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <Button onClick={() => { setError(""); setCreando(true); }}>
          <UserPlus />
          Nuevo usuario
        </Button>
      </CabeceraSeccion>

      <TablaCard
        toolbar={<Buscador value={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre o usuario…" />}
        extra={cargando ? null : `${usuarios.length} usuario${usuarios.length === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Planta</TableHead>
              <TableHead>Configura</TableHead>
              <TableHead>Alta</TableHead>
              <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || filtrados.length === 0 ? (
              <FilaVacia colSpan={6} cargando={cargando} />
            ) : (
              filtrados.map((u) => (
                <TableRow key={u.id} className="cursor-pointer" onClick={() => setAccesosDe(u.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{iniciales(u)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{nombreCompleto(u)}</span>
                        <span className="text-xs text-muted-foreground">{u.username}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>{rolLabel(u.role)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plantLabel(u.defaultPlant) || "Todas"}</TableCell>
                  <TableCell>{badgesPermisos(u)}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(u.created_at).toLocaleDateString("es-ES")}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${u.username}`}>
                            <MoreHorizontal />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuItem onClick={() => setAccesosDe(u.id)}><Eye />Ver accesos</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => abrirEdicion(u)}><Pencil />Editar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => abrirReseteo(u)}><KeyRound />Resetear contraseña</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setBorrando(u)}><Trash2 />Eliminar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TablaCard>

      {/* ── Accesos de un usuario (panel lateral) ─────────────────────────── */}
      <Sheet open={!!accesos} onOpenChange={(o) => !o && setAccesosDe(null)}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          {accesos && (
            <>
              <SheetHeader className="border-b">
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback>{iniciales(accesos)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <SheetTitle>{nombreCompleto(accesos)}</SheetTitle>
                    <SheetDescription>
                      {accesos.username} · {rolLabel(accesos.role)} · planta {plantLabel(accesos.defaultPlant) || "todas"}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 space-y-6 overflow-y-auto p-4">
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">Paneles que ve</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {panelesQueVe(accesos).map((p) => (
                      <Badge key={p.key} variant="outline" className="gap-1 font-normal">
                        <p.Icon className="size-3" />{p.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Se decide por rol en &quot;Roles y permisos&quot;.</p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">Qué puede configurar</h3>
                  {accesos.role === "admin" ? (
                    <p className="text-sm text-muted-foreground">Todo: es administrador.</p>
                  ) : (
                    <div className="divide-y rounded-lg border">
                      {LISTA_PERMISOS.map((p) => {
                        const porRol = permisosDelRol(accesos.role).includes(p);
                        return (
                          <div key={p} className="flex items-center justify-between gap-4 p-3">
                            <div className="grid gap-0.5">
                              <Label htmlFor={`permiso-${p}`}>{PERMISOS[p].label}</Label>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                {porRol ? <><Lock className="size-3" />Por su rol ({rolLabel(accesos.role)})</> : PERMISOS[p].grupo}
                              </span>
                            </div>
                            <Switch
                              id={`permiso-${p}`}
                              checked={porRol || accesos.permisos.includes(p)}
                              disabled={porRol}
                              onCheckedChange={() => togglePermisoExtra(accesos, p)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {accesos.role !== "admin" && (
                    <p className="text-xs text-muted-foreground">
                      Lo que da el rol se cambia en &quot;Roles y permisos&quot;; aquí solo las excepciones de esta persona.
                    </p>
                  )}
                </section>
              </div>

              <SheetFooter className="flex-row border-t">
                <Button variant="outline" className="flex-1" onClick={() => abrirEdicion(accesos)}><Pencil />Editar</Button>
                <Button variant="outline" className="flex-1" onClick={() => abrirReseteo(accesos)}><KeyRound />Contraseña</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Nuevo usuario ─────────────────────────────────────────────────── */}
      <Dialog open={creando} onOpenChange={(o) => !o && cerrarDialogos()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={crear} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Nuevo usuario</DialogTitle>
              <DialogDescription>Lo que ve y puede configurar sale de su rol; las excepciones se añaden después en sus accesos.</DialogDescription>
            </DialogHeader>
            <CamposUsuario datos={nuevo} onChange={setNuevo} roles={roles} />
            <div className="grid gap-2">
              <Label htmlFor="u-password">Contraseña</Label>
              <Input id="u-password" type="password" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="u-forzar">Forzar cambio de contraseña</Label>
                <span className="text-xs text-muted-foreground">Tendrá que cambiarla en su primer inicio de sesión</span>
              </div>
              <Switch id="u-forzar" checked={forzarCambio} onCheckedChange={setForzarCambio} />
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrarDialogos}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !nuevo.username || !nuevaPassword}>
                {guardando && <Loader2 className="animate-spin" />}
                Crear usuario
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Editar usuario ────────────────────────────────────────────────── */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && cerrarDialogos()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={guardarEdicion} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Editar usuario</DialogTitle>
              <DialogDescription>{editando && nombreCompleto(editando)}</DialogDescription>
            </DialogHeader>
            <CamposUsuario datos={edicion} onChange={setEdicion} roles={roles} />
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrarDialogos}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !edicion.username}>
                {guardando && <Loader2 className="animate-spin" />}
                Guardar cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Resetear contraseña ───────────────────────────────────────────── */}
      <Dialog open={!!reseteando} onOpenChange={(o) => !o && cerrarDialogos()}>
        <DialogContent>
          <form onSubmit={resetear} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Resetear contraseña</DialogTitle>
              <DialogDescription>
                Nueva contraseña provisional para <strong>{reseteando?.username}</strong>. Deberá cambiarla al iniciar sesión.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="u-reset">Nueva contraseña</Label>
              <Input id="u-reset" type="password" value={passwordReset} onChange={(e) => setPasswordReset(e.target.value)} autoComplete="new-password" autoFocus />
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrarDialogos}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !passwordReset}>
                {guardando && <Loader2 className="animate-spin" />}
                Resetear
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrarDialogos()}
        title="Eliminar usuario"
        description={<>Se eliminará el usuario <strong>{borrando?.username}</strong> y sus presets y permisos. Esta acción no se puede deshacer.</>}
        onConfirm={borrar}
        pending={guardando}
      />
    </>
  );
}
