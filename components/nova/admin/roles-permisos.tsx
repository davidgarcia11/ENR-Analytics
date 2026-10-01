"use client";

// /admin → Roles y permisos: una sola matriz para ver y decidir qué puede hacer cada
// rol, en vez de repartirlo entre "Roles" (lista) y "Pantallas" (una fila por panel).
//
//   Filas    = cada panel que se puede ver (screens / screen_permissions) y cada
//              configuración del catálogo (lib/permisos.ts → role_permissions),
//              agrupadas por su grupo (Loteadora · Máquinas: Ver, Crear y editar...)
//   Columnas = "Público" (solo paneles: lo ve cualquiera, incluso sin sesión) + un rol
//
// La primera columna (qué es cada fila) queda fija al desplazarse a la derecha, y la
// cabecera (qué rol es cada columna) al bajar: con muchos roles o muchos permisos, si
// no, se pierde de vista qué casilla es cuál. Para que la cabecera se quede arriba,
// la matriz se desplaza dentro de su recuadro (alto de la pantalla), no la página.
//
// Cada casilla se guarda al marcarla (actualización optimista; si el servidor falla,
// se deshace y avisa). El admin lo tiene todo y no es editable. Los permisos
// individuales de un usuario (excepciones) se siguen dando en Usuarios.
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Globe, Loader2, Lock, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/nova/ui/dropdown-menu";
import { PANELS } from "@/lib/panels";
import { LISTA_PERMISOS, PERMISOS, type DefinicionPermiso, type Permiso } from "@/lib/permisos";
import { CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

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

// Nombre interno sugerido a partir de la etiqueta (mismo criterio que normaliza la API)
const aNombreInterno = (label: string) =>
  label.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

// Columna fija a la izquierda y cabecera fija arriba (fondo opaco para que no se vea
// lo que pasa por debajo; la esquina, por encima de las dos)
const FIJA = "sticky left-0 z-10 bg-card";
const CABECERA = "sticky top-0 z-20 bg-muted!";
const ESQUINA = "sticky left-0 top-0 z-30 bg-muted!";
// La tabla se desplaza dentro de su recuadro (si no, la cabecera no puede quedarse fija)
const DESPLAZABLE = "[&_[data-slot=table-container]]:max-h-[calc(100vh-14rem)] [&_[data-slot=table-container]]:overflow-auto";

function Grupo({ titulo, columnas }: { titulo: string; columnas: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={columnas} className="bg-muted/20 py-2 text-xs font-medium text-muted-foreground">
        <span className="sticky left-3">{titulo}</span>
      </TableCell>
    </TableRow>
  );
}

// Permisos del catálogo agrupados por su grupo, en el orden del catálogo
const GRUPOS_PERMISOS = [...new Set(LISTA_PERMISOS.map((p) => PERMISOS[p].grupo))]
  .map((grupo) => ({ grupo, permisos: LISTA_PERMISOS.filter((p) => PERMISOS[p].grupo === grupo) }));

function Bloqueado({ titulo }: { titulo: string }) {
  return (
    <span className="inline-flex text-muted-foreground/60" title={titulo}>
      <Lock className="size-3.5" />
    </span>
  );
}

export default function AdminRolesPermisos({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [roles, setRoles] = useState<Rol[]>([]);
  const [pantallas, setPantallas] = useState<Record<string, ScreenConfig>>({});
  const [usuariosPorRol, setUsuariosPorRol] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<Set<string>>(new Set());

  const [creando, setCreando] = useState(false);
  const [etiqueta, setEtiqueta] = useState("");
  const [nombre, setNombre] = useState("");
  const [nombreTocado, setNombreTocado] = useState(false);
  const [borrando, setBorrando] = useState<Rol | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState("");

  const cargar = async () => {
    try {
      const [resR, resS, resU] = await Promise.all([
        apiFetch("/api/admin/roles"),
        apiFetch("/api/screen-permissions"),
        apiFetch("/api/admin/users"),
      ]);
      if (resR.ok) setRoles(await resR.json());
      if (resS.ok) setPantallas(await resS.json());
      if (resU.ok) {
        const usuarios: { role: string }[] = await resU.json();
        const cuenta: Record<string, number> = {};
        usuarios.forEach((u) => { cuenta[u.role] = (cuenta[u.role] ?? 0) + 1; });
        setUsuariosPorRol(cuenta);
      }
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const paneles = useMemo(() => PANELS.filter((p) => pantallas[p.key]), [pantallas]);
  const columnas = roles.length + 2;

  // Ejecuta un cambio optimista: aplica `aplicar`, llama a la API y, si falla, restaura.
  const conGuardado = async (clave: string, aplicar: () => () => void, peticion: () => Promise<Response>) => {
    if (guardando.has(clave)) return;
    const deshacer = aplicar();
    setGuardando((s) => new Set(s).add(clave));
    try {
      const res = await peticion();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        deshacer();
        toast.error(data.error || "No se ha podido guardar el cambio");
      }
    } catch {
      deshacer();
      toast.error("No se ha podido guardar el cambio");
    } finally {
      setGuardando((s) => { const n = new Set(s); n.delete(clave); return n; });
    }
  };

  const guardarPantalla = (key: string, nueva: ScreenConfig) =>
    conGuardado(
      `pantalla:${key}`,
      () => {
        const anterior = pantallas[key];
        setPantallas((p) => ({ ...p, [key]: nueva }));
        return () => setPantallas((p) => ({ ...p, [key]: anterior }));
      },
      () => apiFetch(`/api/admin/screens/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nueva),
      })
    );

  const togglePublico = (key: string) => {
    const actual = pantallas[key];
    guardarPantalla(key, { ...actual, is_public: !actual.is_public });
  };

  const toggleRolPanel = (key: string, rol: string) => {
    const actual = pantallas[key];
    const tiene = actual.allowed_roles.includes(rol);
    guardarPantalla(key, {
      ...actual,
      allowed_roles: tiene ? actual.allowed_roles.filter((r) => r !== rol) : [...actual.allowed_roles, rol],
    });
  };

  const togglePermisoRol = (rol: Rol, permiso: Permiso) => {
    const enabled = !rol.permisos.includes(permiso);
    const cambiar = (activar: boolean) =>
      setRoles((rs) => rs.map((r) => (r.id !== rol.id ? r : {
        ...r,
        permisos: activar ? [...r.permisos, permiso] : r.permisos.filter((p) => p !== permiso),
      })));
    conGuardado(
      `permiso:${rol.id}:${permiso}`,
      () => { cambiar(enabled); return () => cambiar(!enabled); },
      () => apiFetch(`/api/admin/roles/${rol.id}/permisos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permiso, enabled }),
      })
    );
  };

  // ─── Alta y borrado de roles ──────────────────────────────────────────────────

  const cerrar = () => { setCreando(false); setBorrando(null); setError(""); };

  const abrirAlta = () => { setEtiqueta(""); setNombre(""); setNombreTocado(false); setError(""); setCreando(true); };

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setPendiente(true);
    try {
      const res = await apiFetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nombre, label: etiqueta }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al crear el rol"); return; }
      toast.success(`Rol "${etiqueta}" creado`);
      cerrar();
      cargar();
    } catch { setError("Error de conexión"); } finally { setPendiente(false); }
  };

  const borrar = async () => {
    if (!borrando) return;
    setPendiente(true);
    try {
      const res = await apiFetch(`/api/admin/roles/${borrando.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al eliminar el rol"); return; }
      toast.success(`Rol "${borrando.label}" eliminado`);
      cerrar();
      cargar();
    } catch { toast.error("Error al eliminar el rol"); } finally { setPendiente(false); }
  };

  const nUsuarios = (rol: string) => usuariosPorRol[rol] ?? 0;

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <Button onClick={abrirAlta}>
          <Plus />
          Nuevo rol
        </Button>
      </CabeceraSeccion>

      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">Los cambios se guardan al marcar cada casilla.</span>}
        extra={
          <span className="flex items-center gap-1.5">
            <Lock className="size-3.5" /> El administrador lo tiene todo
          </span>
        }
      >
        <div className={DESPLAZABLE}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={`${ESQUINA} min-w-56`}>Permiso</TableHead>
              <TableHead className={`${CABECERA} w-24 text-center`}>
                <span className="inline-flex items-center gap-1"><Globe className="size-3.5" />Público</span>
              </TableHead>
              {roles.map((r) => (
                <TableHead key={r.id} className={`${CABECERA} w-32 text-center`}>
                  <div className="flex items-center justify-center gap-0.5">
                    <div className="flex flex-col leading-tight">
                      <span className="text-foreground">{r.label}</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        {nUsuarios(r.name)} usuario{nUsuarios(r.name) === 1 ? "" : "s"}
                      </span>
                    </div>
                    {r.name !== "admin" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon-xs" aria-label={`Acciones del rol ${r.label}`}>
                              <MoreHorizontal />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem variant="destructive" onClick={() => setBorrando(r)}>
                            <Trash2 />Eliminar rol
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando ? (
              <FilaVacia colSpan={columnas} cargando />
            ) : (
              <>
                <Grupo titulo="Ver paneles" columnas={columnas} />
                {paneles.map(({ key, label, Icon }) => {
                  const config = pantallas[key];
                  const ocupado = guardando.has(`pantalla:${key}`);
                  return (
                    <TableRow key={key}>
                      <TableCell className={FIJA}>
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <Icon className="size-4 text-muted-foreground" />
                          {label}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Checkbox
                          className="mx-auto"
                          checked={config.is_public}
                          disabled={ocupado}
                          onCheckedChange={() => togglePublico(key)}
                          aria-label={`${label}: público`}
                        />
                      </TableCell>
                      {roles.map((r) => (
                        <TableCell key={r.id} className="text-center">
                          {r.name === "admin" ? (
                            <Bloqueado titulo="El administrador ve todos los paneles" />
                          ) : config.is_public ? (
                            <span className="inline-flex text-muted-foreground/60" title="Es pública: la ve cualquiera">
                              <Check className="size-4" />
                            </span>
                          ) : (
                            <Checkbox
                              className="mx-auto"
                              checked={config.allowed_roles.includes(r.name)}
                              disabled={ocupado}
                              onCheckedChange={() => toggleRolPanel(key, r.name)}
                              aria-label={`${label}: ${r.label}`}
                            />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}

                {GRUPOS_PERMISOS.map(({ grupo, permisos }) => (
                  <Fragment key={grupo}>
                <Grupo titulo={`Configurar · ${grupo}`} columnas={columnas} />
                {permisos.map((p) => (
                  <TableRow key={p}>
                    <TableCell className={FIJA} title={PERMISOS[p].label}>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{(PERMISOS[p] as DefinicionPermiso).accion ?? PERMISOS[p].label}</span>
                        {(PERMISOS[p] as DefinicionPermiso).accion && <span className="text-xs text-muted-foreground">{PERMISOS[p].label}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground/40">—</TableCell>
                    {roles.map((r) => (
                      <TableCell key={r.id} className="text-center">
                        {r.name === "admin" ? (
                          <Bloqueado titulo="El administrador puede configurarlo todo" />
                        ) : (
                          <Checkbox
                            className="mx-auto"
                            checked={r.permisos.includes(p)}
                            disabled={guardando.has(`permiso:${r.id}:${p}`)}
                            onCheckedChange={() => togglePermisoRol(r, p)}
                            aria-label={`${PERMISOS[p].label}: ${r.label}`}
                          />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                  </Fragment>
                ))}
              </>
            )}
          </TableBody>
        </Table>
        </div>
      </TablaCard>

      <Dialog open={creando} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent>
          <form onSubmit={crear} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Nuevo rol</DialogTitle>
              <DialogDescription>Aparecerá como una columna nueva en la matriz, sin ningún permiso marcado.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="r-etiqueta">Nombre del rol</Label>
              <Input
                id="r-etiqueta"
                value={etiqueta}
                onChange={(e) => { setEtiqueta(e.target.value); if (!nombreTocado) setNombre(aNombreInterno(e.target.value)); }}
                placeholder="Calidad"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="r-nombre">Nombre interno</Label>
              <Input
                id="r-nombre"
                value={nombre}
                onChange={(e) => { setNombre(e.target.value); setNombreTocado(true); }}
                placeholder="calidad"
                className="font-mono"
              />
              <span className="text-xs text-muted-foreground">Se rellena solo. Letras, números y guion bajo.</span>
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={pendiente || !nombre || !etiqueta}>
                {pendiente && <Loader2 className="animate-spin" />}
                Crear rol
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrar()}
        title="Eliminar rol"
        description={
          <>
            Se eliminará el rol <strong>{borrando?.label}</strong> con todos sus permisos.
            {borrando && nUsuarios(borrando.name) > 0
              ? ` Sus ${nUsuarios(borrando.name)} usuario${nUsuarios(borrando.name) === 1 ? "" : "s"} pasarán a "user".`
              : " Ningún usuario lo tiene asignado."}
          </>
        }
        onConfirm={borrar}
        pending={pendiente}
      />
    </>
  );
}
