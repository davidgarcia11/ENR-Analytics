"use client";

// /admin → Loteadoras, sobre Nova. Mismas rutas que la versión anterior. El estado
// en vivo solo se consulta mientras esta sección está montada (cada comprobación
// abre una conexión TCP breve a cada máquina), cada 60 s — ver docs/loteadora.md §10.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Switch } from "@/components/nova/ui/switch";
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
}

type EstadoVivo = "activa" | "en_error" | "standby" | "apagada";

// Mismos colores que el estado de las loteadoras en /loteadora (app/loteadora/page.tsx)
const ESTADO_INFO: Record<EstadoVivo, { label: string; className: string }> = {
  activa: { label: "Activa", className: "bg-emerald-400/10 text-emerald-600" },
  en_error: { label: "En error", className: "bg-rose-400/10 text-rose-500" },
  standby: { label: "Sin imprimir", className: "bg-amber-400/10 text-amber-600" },
  apagada: { label: "Sin conexión", className: "bg-muted text-muted-foreground" },
};

interface Datos {
  name: string;
  ip: string;
  port: string;
  slaveAddress: string;
  linea: string;
  enabled: boolean;
}

const VACIO: Datos = { name: "", ip: "", port: "8010", slaveAddress: "0", linea: "", enabled: true };

export default function AdminLoteadoras({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [loteadoras, setLoteadoras] = useState<Loteadora[]>([]);
  const [estados, setEstados] = useState<Record<number, EstadoVivo>>({});
  const [cargando, setCargando] = useState(true);

  // null = cerrado; "nueva" = alta; una loteadora = edición
  const [formulario, setFormulario] = useState<"nueva" | Loteadora | null>(null);
  const [datos, setDatos] = useState<Datos>(VACIO);
  const [borrando, setBorrando] = useState<Loteadora | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadoras");
      if (res.ok) setLoteadoras(await res.json());
    } finally { setCargando(false); }
  };

  const cargarEstados = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadoras/estado");
      if (!res.ok) return;
      const data: { id: number; state: EstadoVivo }[] = await res.json();
      setEstados(Object.fromEntries(data.map((d) => [d.id, d.state])));
    } catch { /* se reintenta en el siguiente ciclo */ }
  };

  useEffect(() => {
    cargar();
    cargarEstados();
    const interval = setInterval(cargarEstados, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cerrar = () => { setFormulario(null); setBorrando(null); setError(""); };

  const abrirAlta = () => { setDatos(VACIO); setError(""); setFormulario("nueva"); };
  const abrirEdicion = (l: Loteadora) => {
    setDatos({ name: l.name, ip: l.ip, port: String(l.port), slaveAddress: String(l.slave_address), linea: l.linea, enabled: !!l.enabled });
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
          linea: datos.linea, ...(esNueva ? {} : { enabled: datos.enabled }),
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
        <Button onClick={abrirAlta}>
          <Plus />
          Nueva loteadora
        </Button>
      </CabeceraSeccion>
      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">El estado se comprueba en vivo cada minuto mientras esta sección está abierta.</span>}
        extra={cargando ? null : `${loteadoras.length} máquina${loteadoras.length === 1 ? "" : "s"}`}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Conexión</TableHead>
                <TableHead>Línea</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando || loteadoras.length === 0 ? (
                <FilaVacia colSpan={5} cargando={cargando} texto="No hay loteadoras configuradas" />
              ) : (
                loteadoras.map((l) => {
                  const vivo = estados[l.id];
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium text-foreground">{l.name}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{l.ip}:{l.port}</span>
                        <span className="ml-2 text-xs text-muted-foreground">· slave {l.slave_address}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.linea || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {!l.enabled && <Badge variant="outline">Deshabilitada</Badge>}
                          {vivo ? (
                            <Badge className={ESTADO_INFO[vivo].className}>{ESTADO_INFO[vivo].label}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground"><Loader2 className="animate-spin" />Comprobando</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${l.name}`}>
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="min-w-40">
                            <DropdownMenuItem onClick={() => abrirEdicion(l)}><Pencil />Editar</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setBorrando(l)}><Trash2 />Eliminar</DropdownMenuItem>
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
