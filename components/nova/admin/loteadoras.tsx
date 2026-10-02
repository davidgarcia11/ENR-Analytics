"use client";

// /admin → Loteadoras, sobre Nova. Mismas rutas que la versión anterior. El estado
// en vivo solo se consulta mientras esta sección está montada (cada comprobación
// abre una conexión TCP breve a cada máquina), cada 60 s — ver docs/loteadora.md §10.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso, type Permiso } from "@/lib/permisos";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Switch } from "@/components/nova/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import {
  Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList,
  ComboboxValue, useComboboxAnchor,
} from "@/components/nova/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import { CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Loteadora {
  id: number;
  name: string;
  ip: string;
  port: number;
  slave_address: number;
  enabled: number;
  linea: string;
  /** Familias F4101.IMSRP2 que ofrece en /loteadora, separadas por comas ("" = todas) */
  familias: string;
  zona_id: number | null;
  zona: string | null;
}

type EstadoVivo = "activa" | "con_avisos" | "en_error" | "standby" | "apagada";

// Mismos colores que el estado de las loteadoras en /loteadora (app/loteadora/page.tsx)
const ESTADO_INFO: Record<EstadoVivo, { label: string; className: string }> = {
  activa: { label: "Imprimiendo", className: "bg-sky-400/10 text-sky-600" },
  con_avisos: { label: "Con avisos", className: "bg-amber-400/10 text-amber-600" },
  en_error: { label: "En error", className: "bg-rose-400/10 text-rose-500" },
  standby: { label: "Conectada", className: "bg-emerald-400/10 text-emerald-600" },
  apagada: { label: "Sin conexión", className: "bg-muted text-muted-foreground" },
};

interface Datos {
  name: string;
  ip: string;
  port: string;
  slaveAddress: string;
  linea: string;
  enabled: boolean;
  familias: string[];
  zonaId: string | null;
}

const VACIO: Datos = { name: "", ip: "", port: "8010", slaveAddress: "0", linea: "", enabled: true, familias: [], zonaId: null };
const aLista = (csv: string) => csv.split(",").filter(Boolean);

export default function AdminLoteadoras({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  // Cada botón según su permiso (lib/permisos.ts); el servidor lo vuelve a comprobar.
  const usuario = useSession().user;
  const puede = (accion: string) => tienePermiso(usuario, `admin.loteadora.maquinas.${accion}` as Permiso);
  const [loteadoras, setLoteadoras] = useState<Loteadora[]>([]);
  const [estados, setEstados] = useState<Record<number, EstadoVivo>>({});
  // Por qué no responde cada una (solo las "Sin conexión") y qué avisos tiene (las demás)
  const [motivos, setMotivos] = useState<Record<number, string>>({});
  const [avisos, setAvisos] = useState<Record<number, { texto: string; error: boolean }[]>>({});
  const [cargando, setCargando] = useState(true);

  // null = cerrado; "nueva" = alta; una loteadora = edición
  const [formulario, setFormulario] = useState<"nueva" | Loteadora | null>(null);
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [borrando, setBorrando] = useState<Loteadora | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  // Familias con artículos de loteadora (código → nombre), sacadas de la misma
  // lista que usa /loteadora: solo se ofrecen familias que tienen algo que imprimir.
  const [familias, setFamilias] = useState<Map<string, string>>(new Map());
  const anclaFamilias = useComboboxAnchor();
  const nombreFamilia = (id: string) => (familias.get(id) ? `${id} — ${familias.get(id)}` : id);

  // Zonas (/admin → Zonas): deciden quién ve cada loteadora
  const [zonas, setZonas] = useState<{ id: number; nombre: string }[]>([]);
  const cargarZonas = async () => {
    const res = await apiFetch("/api/admin/zonas").catch(() => null);
    if (res?.ok) setZonas(await res.json());
  };

  const cargarFamilias = async () => {
    try {
      const res = await apiFetch("/api/loteadora/articulos");
      if (!res.ok) return;
      const arts: { familia: string; familiaDesc: string }[] = await res.json();
      setFamilias(new Map(arts.filter((a) => a.familia).map((a) => [a.familia, a.familiaDesc] as [string, string]).sort((a, b) => a[0].localeCompare(b[0]))));
    } catch { /* sin JDE no se pueden elegir familias; lo ya guardado se conserva */ }
  };

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadoras");
      if (res.ok) setLoteadoras(await res.json());
    } finally { setCargando(false); }
  };

  // Historial de conexión (ping cada 30 s, lib/loteadora-ping.ts) en CSV
  const descargarHistorial = async (l: Loteadora) => {
    try {
      const res = await apiFetch(`/api/admin/loteadoras/${l.id}/historial-conexion`);
      if (!res.ok) { toast.error("No se pudo descargar el historial"); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `conexion-${l.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Error de conexión"); }
  };

  const cargarEstados = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadoras/estado");
      if (!res.ok) return;
      const data: { id: number; state: EstadoVivo; motivo?: string; avisos?: { texto: string; error: boolean }[] }[] = await res.json();
      setEstados(Object.fromEntries(data.map((d) => [d.id, d.state])));
      setMotivos(Object.fromEntries(data.filter((d) => d.motivo).map((d) => [d.id, d.motivo!])));
      setAvisos(Object.fromEntries(data.filter((d) => d.avisos).map((d) => [d.id, d.avisos!])));
    } catch { /* se reintenta en el siguiente ciclo */ }
  };

  useEffect(() => {
    cargar();
    cargarEstados();
    cargarFamilias();
    cargarZonas();
    const interval = setInterval(cargarEstados, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cerrar = () => { setFormulario(null); setBorrando(null); setError(""); };

  const abrirAlta = () => { setDatos(VACIO); setError(""); setFormulario("nueva"); };
  const abrirEdicion = (l: Loteadora) => {
    setDatos({ name: l.name, ip: l.ip, port: String(l.port), slaveAddress: String(l.slave_address), linea: l.linea, enabled: !!l.enabled, familias: aLista(l.familias ?? ""), zonaId: l.zona_id ? String(l.zona_id) : null });
    setError("");
    setFormulario(l);
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulario) return;
    const esNueva = formulario === "nueva";
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch(esNueva ? "/api/admin/loteadoras" : `/api/admin/loteadoras/${formulario.id}`, {
        method: esNueva ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: datos.name, ip: datos.ip, port: Number(datos.port), slaveAddress: Number(datos.slaveAddress),
          linea: datos.linea, familias: datos.familias, zonaId: datos.zonaId ? Number(datos.zonaId) : null, ...(esNueva ? {} : { enabled: datos.enabled }),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al guardar"); return; }
      toast.success(`Loteadora "${datos.name}" ${esNueva ? "creada" : "actualizada"}`);
      cerrar();
      cargar();
      cargarEstados();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/loteadoras/${borrando.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al eliminar"); return; }
      toast.success(`Loteadora "${borrando.name}" eliminada`);
      cerrar();
      cargar();
    } catch { toast.error("Error al eliminar"); } finally { setGuardando(false); }
  };

  const campo = (k: keyof Datos) => (e: React.ChangeEvent<HTMLInputElement>) => setDatos((d) => ({ ...d, [k]: e.target.value }));
  const editando = formulario && formulario !== "nueva";

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        {puede("editar") && <Button onClick={abrirAlta}>
          <Plus />
          Nueva loteadora
        </Button>}
      </CabeceraSeccion>
      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">El estado se comprueba en vivo cada minuto mientras esta sección está abierta.</span>}
        extra={cargando ? null : `${loteadoras.length} máquina${loteadoras.length === 1 ? "" : "s"}`}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Zona</TableHead>
                <TableHead>Conexión</TableHead>
                <TableHead>Línea</TableHead>
                <TableHead>Familias</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando || loteadoras.length === 0 ? (
                <FilaVacia colSpan={7} cargando={cargando} texto="No hay loteadoras configuradas" />
              ) : (
                loteadoras.map((l) => {
                  const vivo = estados[l.id];
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium text-foreground">{l.name}</TableCell>
                      <TableCell>{l.zona ? <Badge variant="outline">{l.zona}</Badge> : <span className="text-xs text-muted-foreground">Sin zona</span>}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{l.ip}:{l.port}</span>
                        <span className="ml-2 text-xs text-muted-foreground">· slave {l.slave_address}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.linea || "—"}</TableCell>
                      <TableCell>
                        {aLista(l.familias ?? "").length === 0 ? (
                          <span className="text-xs text-muted-foreground">Todas</span>
                        ) : (
                          <div className="flex max-w-64 flex-wrap gap-1">
                            {aLista(l.familias).map((f) => (
                              <Badge key={f} variant="outline" className="font-normal" title={nombreFamilia(f)}>{familias.get(f) || f}</Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {!l.enabled && <Badge variant="outline">Deshabilitada</Badge>}
                          {vivo ? (
                            <Badge className={ESTADO_INFO[vivo].className}>{ESTADO_INFO[vivo].label}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground"><Loader2 className="animate-spin" />Comprobando</Badge>
                          )}
                        </div>
                        {motivos[l.id] && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{motivos[l.id]}</p>}
                        {avisos[l.id] && (
                          <p className="mt-1 max-w-xs text-xs">
                            {avisos[l.id].map((a, i) => (
                              <span key={i} className={a.error ? "text-rose-500" : "text-amber-600"}>{i > 0 && " · "}{a.texto}</span>
                            ))}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* El historial de conexión lo ve cualquiera con acceso a Máquinas */}
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${l.name}`}>
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="min-w-48">
                            <DropdownMenuItem onClick={() => descargarHistorial(l)}><Activity />Historial de conexión</DropdownMenuItem>
                            {puede("editar") && <DropdownMenuItem onClick={() => abrirEdicion(l)}><Pencil />Editar</DropdownMenuItem>}
                            {puede("eliminar") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setBorrando(l)}><Trash2 />Eliminar</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
      </TablaCard>

      <Dialog open={!!formulario} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={guardar} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{editando ? "Editar loteadora" : "Nueva loteadora"}</DialogTitle>
              <DialogDescription>IP, puerto y Slave Address tal y como están configurados en la máquina.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="l-nombre">Nombre</Label>
                <Input id="l-nombre" value={datos.name} onChange={campo("name")} placeholder="Loteadora línea 1" autoFocus />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="l-linea">Línea de fabricación</Label>
                <Input id="l-linea" value={datos.linea} onChange={campo("linea")} placeholder="Línea 1" />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="l-ip">IP</Label>
                <Input id="l-ip" value={datos.ip} onChange={campo("ip")} placeholder="192.168.1.10" className="font-mono" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="l-puerto">Puerto</Label>
                <Input id="l-puerto" type="number" value={datos.port} onChange={campo("port")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="l-slave">Slave Address</Label>
                <Input id="l-slave" type="number" value={datos.slaveAddress} onChange={campo("slaveAddress")} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Zona</Label>
              <Select
                items={[{ value: "", label: "Sin zona" }, ...zonas.map((z) => ({ value: String(z.id), label: z.nombre }))]}
                value={datos.zonaId ?? ""}
                onValueChange={(v) => setDatos((d) => ({ ...d, zonaId: (v as string) || null }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin zona</SelectItem>
                  {zonas.map((z) => <SelectItem key={z.id} value={String(z.id)}>{z.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Informativa y para decidir quién la ve (roles y usuarios de cada zona en /admin → Zonas). Sin zona, no la ven los usuarios restringidos a alguna zona.
              </span>
            </div>
            <div className="grid gap-2">
              <Label>Familias de artículos</Label>
              <Combobox
                multiple
                items={[...familias.keys()]}
                value={datos.familias}
                onValueChange={(v) => setDatos((d) => ({ ...d, familias: v as string[] }))}
                itemToStringLabel={nombreFamilia}
              >
                <ComboboxChips ref={anclaFamilias}>
                  <ComboboxValue>
                    {(valores: string[]) => (
                      <>
                        {valores.map((f) => <ComboboxChip key={f}>{familias.get(f) || f}</ComboboxChip>)}
                        <ComboboxChipsInput placeholder={valores.length ? "" : "Todas (elige para limitar)"} />
                      </>
                    )}
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={anclaFamilias}>
                  <ComboboxEmpty>{familias.size ? "Sin resultados" : "No se han podido cargar las familias (¿JDE caído?)"}</ComboboxEmpty>
                  <ComboboxList>
                    {(f: string) => <ComboboxItem key={f} value={f}>{nombreFamilia(f)}</ComboboxItem>}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <span className="text-xs text-muted-foreground">
                En /loteadora, al elegir esta máquina solo se ofrecen artículos de estas familias. Sin ninguna, se ofrecen todos.
              </span>
            </div>
            {editando && (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="grid gap-0.5">
                  <Label htmlFor="l-habilitada">Habilitada</Label>
                  <span className="text-xs text-muted-foreground">Si está deshabilitada no aparece para elegir en /loteadora</span>
                </div>
                <Switch id="l-habilitada" checked={datos.enabled} onCheckedChange={(c) => setDatos((d) => ({ ...d, enabled: c }))} />
              </div>
            )}
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !datos.name || !datos.ip || !datos.linea}>
                {guardando && <Loader2 className="animate-spin" />}
                {editando ? "Guardar cambios" : "Crear loteadora"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrar()}
        title="Eliminar loteadora"
        description={<>Se eliminará la loteadora <strong>{borrando?.name}</strong>. Esta acción no se puede deshacer.</>}
        onConfirm={borrar}
        pending={guardando}
      />
    </>
  );
}
