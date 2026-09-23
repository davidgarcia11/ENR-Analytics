"use client";

// /admin → Plantillas (loteadora_mensajes), sobre Nova. Mismas rutas y los mismos
// seis IDs de campo que la versión anterior — ver docs/loteadora.md §13.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import { CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Mensaje {
  id: number;
  name: string;
  lot_field_id: number;
  cocida_field_id: number;
  expiry_field_id: number;
  hora_field_id: number;
  turno_field_id: number;
  linea_field_id: number;
}

// Orden y nombre de los campos, con la columna de BD y la clave que espera la API
const CAMPOS = [
  { label: "Lote", col: "lot_field_id", api: "lotFieldId", defecto: "1" },
  { label: "Cocida", col: "cocida_field_id", api: "cocidaFieldId", defecto: "2" },
  { label: "Caducidad", col: "expiry_field_id", api: "expiryFieldId", defecto: "3" },
  { label: "Hora", col: "hora_field_id", api: "horaFieldId", defecto: "4" },
  { label: "Turno", col: "turno_field_id", api: "turnoFieldId", defecto: "5" },
  { label: "Línea", col: "linea_field_id", api: "lineaFieldId", defecto: "6" },
] as const;

type Api = (typeof CAMPOS)[number]["api"];
type Datos = { name: string } & Record<Api, string>;

const vacio = (): Datos => ({ name: "", ...Object.fromEntries(CAMPOS.map((c) => [c.api, c.defecto])) } as Datos);

export default function AdminPlantillas({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);

  const [formulario, setFormulario] = useState<"nueva" | Mensaje | null>(null);
  const [datos, setDatos] = useState<Datos>(vacio);
  const [borrando, setBorrando] = useState<Mensaje | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadora-mensajes");
      if (res.ok) setMensajes(await res.json());
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const cerrar = () => { setFormulario(null); setBorrando(null); setError(""); };

  const abrirEdicion = (m: Mensaje) => {
    setDatos({ name: m.name, ...Object.fromEntries(CAMPOS.map((c) => [c.api, String(m[c.col])])) } as Datos);
    setError("");
    setFormulario(m);
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulario) return;
    const esNueva = formulario === "nueva";
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch(esNueva ? "/api/admin/loteadora-mensajes" : `/api/admin/loteadora-mensajes/${formulario.id}`, {
        method: esNueva ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: datos.name, ...Object.fromEntries(CAMPOS.map((c) => [c.api, Number(datos[c.api])])) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al guardar"); return; }
      toast.success(`Plantilla "${datos.name}" ${esNueva ? "creada" : "actualizada"}`);
      cerrar();
      cargar();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const borrar = async () => {
    if (!borrando) return;
    setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/loteadora-mensajes/${borrando.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al eliminar"); return; }
      toast.success(`Plantilla "${borrando.name}" eliminada`);
      cerrar();
      cargar();
    } catch { toast.error("Error al eliminar"); } finally { setGuardando(false); }
  };

  const editando = formulario && formulario !== "nueva";

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <Button onClick={() => { setDatos(vacio()); setError(""); setFormulario("nueva"); }}>
          <Plus />
          Nueva plantilla
        </Button>
      </CabeceraSeccion>
      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">El nombre debe coincidir exactamente con el mensaje creado en la máquina.</span>}
        extra={cargando ? null : `${mensajes.length} plantilla${mensajes.length === 1 ? "" : "s"}`}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plantilla</TableHead>
                <TableHead>IDs de campo</TableHead>
                <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando || mensajes.length === 0 ? (
                <FilaVacia colSpan={3} cargando={cargando} texto="No hay plantillas configuradas" />
              ) : (
                mensajes.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-sm font-medium text-foreground">{m.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {CAMPOS.map((c) => (
                          <Badge key={c.col} variant="outline" className="gap-1 font-normal">
                            <span className="text-muted-foreground">{c.label}</span>
                            <span className="font-mono font-semibold">{m[c.col]}</span>
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${m.name}`}>
                              <MoreHorizontal />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="min-w-40">
                          <DropdownMenuItem onClick={() => abrirEdicion(m)}><Pencil />Editar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setBorrando(m)}><Trash2 />Eliminar</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
              <DialogTitle>{editando ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
              <DialogDescription>
                Cada ID es el &quot;ID de datos&quot; del Field Module correspondiente en la máquina. Deben ser distintos entre sí.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="m-nombre">Nombre del mensaje</Label>
              <Input id="m-nombre" value={datos.name} onChange={(e) => setDatos((d) => ({ ...d, name: e.target.value }))} placeholder="pruebaDavid.msg" className="font-mono" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {CAMPOS.map((c) => (
                <div key={c.api} className="grid gap-2">
                  <Label htmlFor={`m-${c.api}`}>{c.label}</Label>
                  <Input
                    id={`m-${c.api}`}
                    type="number"
                    min={0}
                    max={255}
                    value={datos[c.api]}
                    onChange={(e) => setDatos((d) => ({ ...d, [c.api]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !datos.name}>
                {guardando && <Loader2 className="animate-spin" />}
                {editando ? "Guardar cambios" : "Crear plantilla"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrar()}
        title="Eliminar plantilla"
        description={<>Se eliminará la plantilla <strong>{borrando?.name}</strong> y las asociaciones de artículos que la usen. Esta acción no se puede deshacer.</>}
        onConfirm={borrar}
        pending={guardando}
      />
    </>
  );
}
