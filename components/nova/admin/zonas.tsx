"use client";

// /admin → Loteadora › Zonas: las zonas de las loteadoras (Funes 1, Funes 2,
// Pasteurizado...) y qué roles y usuarios ven cada una. La zona de cada máquina se
// elige en Máquinas. Reglas de visibilidad en lib/loteadora-zonas.ts; ver
// docs/loteadora.md §17. Solo admin.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso, type Permiso } from "@/lib/permisos";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList,
  ComboboxValue, useComboboxAnchor,
} from "@/components/nova/ui/combobox";
import { CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Zona { id: number; nombre: string; loteadoras: number; roles: number[]; usuarios: number[] }
interface Rol { id: number; name: string; label: string }
interface Usuario { id: number; username: string; name: string; surname: string; role: string }

const nombreUsuario = (u: Usuario) => [u.name, u.surname].filter(Boolean).join(" ") || u.username;

export default function AdminZonas({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  // Cada botón según su permiso (lib/permisos.ts); el servidor lo vuelve a comprobar.
  const usuario = useSession().user;
  const puede = (accion: string) => tienePermiso(usuario, `admin.loteadora.zonas.${accion}` as Permiso);
  const [zonas, setZonas] = useState<Zona[]>([]);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);

  const [formulario, setFormulario] = useState<"nueva" | Zona | null>(null);
  const [nombre, setNombre] = useState("");
  const [rolesSel, setRolesSel] = useState<number[]>([]);
  const [usuariosSel, setUsuariosSel] = useState<string[]>([]);
  const [borrando, setBorrando] = useState<Zona | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const anclaUsuarios = useComboboxAnchor();

  // El admin ve todas las loteadoras: no tiene sentido asignarle zonas
  const rolesAsignables = roles.filter((r) => r.name !== "admin");
  const usuariosAsignables = usuarios.filter((u) => u.role !== "admin");
  const usuarioPorId = new Map(usuarios.map((u) => [String(u.id), u]));

  const cargar = async () => {
    try {
      // Zonas con los roles y usuarios a los que se pueden asignar (ver GET /api/admin/zonas)
      const res = await apiFetch("/api/admin/zonas?opciones=1");
      if (res.ok) {
        const d = await res.json();
        setZonas(d.zonas); setRoles(d.roles); setUsuarios(d.usuarios);
      }
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const cerrar = () => { setFormulario(null); setBorrando(null); setError(""); };
  const abrir = (z: Zona | "nueva") => {
    setNombre(z === "nueva" ? "" : z.nombre);
    setRolesSel(z === "nueva" ? [] : z.roles);
    setUsuariosSel(z === "nueva" ? [] : z.usuarios.map(String));
    setError("");
    setFormulario(z);
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulario) return;
    const esNueva = formulario === "nueva";
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch(esNueva ? "/api/admin/zonas" : `/api/admin/zonas/${formulario.id}`, {
        method: esNueva ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, roles: rolesSel, usuarios: usuariosSel.map(Number) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al guardar"); return; }
      toast.success(`Zona "${nombre}" ${esNueva ? "creada" : "actualizada"}`);
      cerrar();
      cargar();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/zonas/${borrando.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al eliminar"); return; }
      toast.success(`Zona "${borrando.nombre}" eliminada`);
      cerrar();
      cargar();
    } catch { toast.error("Error de conexión"); } finally { setGuardando(false); }
  };

  const rolLabel = (id: number) => roles.find((r) => r.id === id)?.label ?? `#${id}`;

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        {puede("editar") && (
          <Button onClick={() => abrir("nueva")}>
            <Plus />
            Nueva zona
          </Button>
        )}
      </CabeceraSeccion>
      <TablaCard
        toolbar={
          <span className="text-sm text-muted-foreground">
            Cada rol o usuario ve solo las loteadoras de sus zonas; sin zonas asignadas, ve todas. Las zonas de un usuario sustituyen a las de su rol. El admin ve siempre todas.
          </span>
        }
        extra={cargando ? null : `${zonas.length} zona${zonas.length === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zona</TableHead>
              <TableHead className="w-24">Loteadoras</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Usuarios</TableHead>
              <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || zonas.length === 0 ? (
              <FilaVacia colSpan={5} cargando={cargando} texto="No hay zonas" />
            ) : (
              zonas.map((z) => (
                <TableRow key={z.id}>
                  <TableCell className="font-medium text-foreground">{z.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{z.loteadoras}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {z.roles.length ? z.roles.map((id) => <Badge key={id} variant="outline">{rolLabel(id)}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {z.usuarios.length
                        ? z.usuarios.map((id) => <Badge key={id} variant="outline">{usuarioPorId.get(String(id)) ? nombreUsuario(usuarioPorId.get(String(id))!) : `#${id}`}</Badge>)
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(puede("editar") || puede("eliminar")) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${z.nombre}`}><MoreHorizontal /></Button>} />
                        <DropdownMenuContent align="end" className="min-w-40">
                          {puede("editar") && <DropdownMenuItem onClick={() => abrir(z)}><Pencil />Editar</DropdownMenuItem>}
                          {puede("editar") && puede("eliminar") && <DropdownMenuSeparator />}
                          {puede("eliminar") && <DropdownMenuItem variant="destructive" onClick={() => setBorrando(z)}><Trash2 />Eliminar</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TablaCard>

      <Dialog open={!!formulario} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={guardar} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{formulario === "nueva" ? "Nueva zona" : "Editar zona"}</DialogTitle>
              <DialogDescription>Quién ve las loteadoras de esta zona en /loteadora.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="z-nombre">Nombre</Label>
              <Input id="z-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Funes 1" autoFocus />
            </div>
            <div className="grid gap-2">
              <Label>Roles</Label>
              {rolesAsignables.length === 0 ? (
                <span className="text-xs text-muted-foreground">No hay roles además de administrador.</span>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {rolesAsignables.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={rolesSel.includes(r.id)}
                        onCheckedChange={(v) => setRolesSel((s) => (v === true ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Usuarios</Label>
              <Combobox
                multiple
                items={usuariosAsignables.map((u) => String(u.id))}
                value={usuariosSel}
                onValueChange={(v) => setUsuariosSel(v as string[])}
                itemToStringLabel={(id: string) => (usuarioPorId.get(id) ? `${nombreUsuario(usuarioPorId.get(id)!)} (${usuarioPorId.get(id)!.username})` : id)}
              >
                <ComboboxChips ref={anclaUsuarios}>
                  <ComboboxValue>
                    {(valores: string[]) => (
                      <>
                        {valores.map((id) => <ComboboxChip key={id}>{usuarioPorId.get(id) ? nombreUsuario(usuarioPorId.get(id)!) : id}</ComboboxChip>)}
                        <ComboboxChipsInput placeholder={valores.length ? "" : "Buscar usuario…"} />
                      </>
                    )}
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={anclaUsuarios}>
                  <ComboboxEmpty>Sin resultados</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => {
                      const u = usuarioPorId.get(id)!;
                      return <ComboboxItem key={id} value={id}>{nombreUsuario(u)} <span className="text-muted-foreground">({u.username})</span></ComboboxItem>;
                    }}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <span className="text-xs text-muted-foreground">
                Para excepciones: un usuario con zonas propias ve solo esas, aunque su rol tenga otras.
              </span>
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !nombre.trim()}>
                {guardando && <Loader2 className="animate-spin" />}
                {formulario === "nueva" ? "Crear zona" : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrar()}
        title="Eliminar zona"
        description={
          borrando?.loteadoras
            ? `Las ${borrando.loteadoras} loteadoras de "${borrando.nombre}" se quedarán sin zona (y dejarán de verlas los usuarios restringidos a alguna zona).`
            : `Se eliminará la zona "${borrando?.nombre}".`
        }
        onConfirm={borrar}
        pending={guardando}
      />
    </>
  );
}
