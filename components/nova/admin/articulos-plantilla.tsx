"use client";

// /admin → Artículos → Plantilla (loteadora_articulo_mensajes), sobre Nova. Mismas
// rutas que la versión anterior. Es la sección que puede abrir un usuario no admin
// con los permisos de Artículos (ver, asociar, desvincular; lib/permisos.ts): por eso solo LEE
// las plantillas (GET), nunca las edita.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, MoreHorizontal, Unlink } from "lucide-react";
import { useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso, type Permiso } from "@/lib/permisos";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/nova/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/nova/ui/dropdown-menu";
import { BotonesCopia, Buscador, CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Asociacion {
  articulo_id: string;
  mensaje_id: number;
  mensaje_name: string;
  // Datos de JDE del artículo (null si JDE no respondió)
  jde: { descripcion: string | null; diasCaducidad: number | null; estado: "obsoleto" | "fuera" | "no_existe" | null } | null;
}

// Por qué un artículo con plantilla ya no se puede elegir en /loteadora
const ESTADO_JDE = {
  obsoleto: { label: "Obsoleto", title: "Obsoleto en JDE: no sale en /loteadora. Si no se va a reactivar, quita la asociación." },
  fuera: { label: "No sale en /loteadora", title: "Ya no cumple los filtros de JDE de la loteadora (categoría 1 = 12 y categoría 6 = Y)." },
  no_existe: { label: "No existe en JDE", title: "Este código ya no está en JDE." },
} as const;

interface Articulo {
  id: string;
  descripcion: string;
}

interface Mensaje {
  id: number;
  name: string;
}

export default function AdminArticulosPlantilla({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  // Cada botón según su permiso (lib/permisos.ts); el servidor lo vuelve a comprobar.
  const usuario = useSession().user;
  const puede = (accion: string) => tienePermiso(usuario, `admin.loteadora.articulos.${accion}` as Permiso);
  const [asociaciones, setAsociaciones] = useState<Asociacion[]>([]);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoArticulos, setCargandoArticulos] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const [asociando, setAsociando] = useState(false);
  const [articuloId, setArticuloId] = useState<string | null>(null);
  const [mensajeId, setMensajeId] = useState<string>("");
  const [quitando, setQuitando] = useState<Asociacion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargarAsociaciones = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadora-articulos");
      if (res.ok) setAsociaciones(await res.json());
    } finally { setCargando(false); }
  };

  useEffect(() => {
    cargarAsociaciones();
    (async () => {
      const res = await apiFetch("/api/admin/loteadora-mensajes");
      if (res.ok) setMensajes(await res.json());
    })();
    // Catálogo de artículos de JDE (Oracle): tarda más, se carga aparte
    (async () => {
      try {
        const res = await apiFetch("/api/loteadora/articulos");
        if (res.ok) setArticulos(await res.json());
      } finally { setCargandoArticulos(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const descripcionDe = useMemo(() => new Map(articulos.map((a) => [a.id, a.descripcion])), [articulos]);
  const articuloIds = useMemo(() => articulos.map((a) => a.id), [articulos]);
  const articuloLabel = (id: string) => (descripcionDe.has(id) ? `${id} — ${descripcionDe.get(id)}` : id);
  const mensajeItems = mensajes.map((m) => ({ value: String(m.id), label: m.name }));

  // La descripción viene con la asociación (JDE); si JDE no respondió, la del catálogo
  const descripcionFila = (a: Asociacion) => a.jde?.descripcion ?? descripcionDe.get(a.articulo_id) ?? null;
  const estado = (a: Asociacion) => (a.jde?.estado ? ESTADO_JDE[a.jde.estado] : null);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return asociaciones;
    // También por la etiqueta: «obsoleto» deja solo las que sobran
    return asociaciones.filter((a) =>
      `${a.articulo_id} ${descripcionFila(a) ?? ""} ${a.mensaje_name} ${estado(a)?.label ?? ""}`.toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asociaciones, busqueda, descripcionDe]);

  const cerrar = () => { setAsociando(false); setQuitando(null); setError(""); };

  const abrirAsociar = () => { setArticuloId(null); setMensajeId(""); setError(""); setAsociando(true); };

  const asociar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!articuloId || !mensajeId) return;
    setError(""); setGuardando(true);
    try {
      const res = await apiFetch("/api/admin/loteadora-articulos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articuloId, mensajeId: Number(mensajeId) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al asociar"); return; }
      toast.success(`Artículo ${articuloId} asociado`);
      cerrar();
      cargarAsociaciones();
    } catch { setError("Error de conexión"); } finally { setGuardando(false); }
  };

  const quitar = async () => {
    if (!quitando) return;
    setGuardando(true);
    try {
      const res = await apiFetch(`/api/admin/loteadora-articulos/${quitando.articulo_id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al quitar la asociación"); return; }
      toast.success(`Asociación de ${quitando.articulo_id} quitada`);
      cerrar();
      cargarAsociaciones();
    } catch { toast.error("Error al quitar la asociación"); } finally { setGuardando(false); }
  };

  const yaAsociado = articuloId ? asociaciones.find((a) => a.articulo_id === articuloId) : undefined;

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <BotonesCopia ruta="/api/admin/loteadora-articulos/copia" archivo="articulos-loteadora" onImportado={cargarAsociaciones} puedeImportar={puede("editar")} />
        {puede("editar") && (
          <Button onClick={abrirAsociar}>
            <Link2 />
            Asociar artículo
          </Button>
        )}
      </CabeceraSeccion>
      <TablaCard
        toolbar={<Buscador value={busqueda} onChange={setBusqueda} placeholder="Buscar por artículo o plantilla…" />}
        extra={cargando ? null : `${asociaciones.length} artículo${asociaciones.length === 1 ? "" : "s"} con plantilla`}
      >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Caducidad</TableHead>
                <TableHead>Plantilla</TableHead>
                <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargando || filtradas.length === 0 ? (
                <FilaVacia colSpan={5} cargando={cargando} texto={asociaciones.length === 0 ? "Ningún artículo tiene plantilla todavía" : "Sin resultados"} />
              ) : (
                filtradas.map((a) => {
                  const est = estado(a);
                  const dias = a.jde?.diasCaducidad;
                  return (
                  <TableRow key={a.articulo_id}>
                    <TableCell className="font-mono text-sm font-medium text-foreground">{a.articulo_id}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="flex flex-wrap items-center gap-2">
                        {descripcionFila(a) ?? (!a.jde && cargandoArticulos ? "…" : "—")}
                        {est && <Badge className="bg-amber-400/10 text-amber-600" title={est.title}>{est.label}</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {dias == null ? "—" : `${dias} día${dias === 1 ? "" : "s"}`}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="font-mono">{a.mensaje_name}</Badge></TableCell>
                    <TableCell>
                      {puede("eliminar") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${a.articulo_id}`}>
                                <MoreHorizontal />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuItem variant="destructive" onClick={() => setQuitando(a)}><Unlink />Quitar asociación</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
      </TablaCard>

      <Dialog open={asociando} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={asociar} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Asociar artículo a plantilla</DialogTitle>
              <DialogDescription>Al elegir este artículo en /loteadora se cargará sola esta plantilla en la máquina.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>Artículo {cargandoArticulos && <Loader2 className="size-3 animate-spin text-muted-foreground" />}</Label>
              <Combobox items={articuloIds} value={articuloId} onValueChange={(v) => setArticuloId(v as string | null)} itemToStringLabel={articuloLabel}>
                <ComboboxInput
                  placeholder={cargandoArticulos ? "Cargando artículos…" : "Buscar por código o descripción…"}
                  disabled={cargandoArticulos}
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>Sin resultados</ComboboxEmpty>
                  <ComboboxList>
                    {(id: string) => <ComboboxItem key={id} value={id}>{articuloLabel(id)}</ComboboxItem>}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {yaAsociado && (
                <span className="text-xs text-amber-600">
                  Ya tiene la plantilla <strong className="font-mono">{yaAsociado.mensaje_name}</strong>; se sustituirá.
                </span>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Plantilla</Label>
              <Select items={mensajeItems} value={mensajeId || null} onValueChange={(v) => setMensajeId((v as string) ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={mensajes.length === 0 ? "No hay plantillas configuradas" : "Seleccionar plantilla…"} />
                </SelectTrigger>
                <SelectContent>
                  {mensajeItems.map((m) => <SelectItem key={m.value} value={m.value} className="font-mono">{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !articuloId || !mensajeId}>
                {guardando && <Loader2 className="animate-spin" />}
                Asociar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!quitando}
        onOpenChange={(o) => !o && cerrar()}
        title="Quitar asociación"
        description={<>El artículo <strong className="font-mono">{quitando?.articulo_id}</strong> dejará de tener plantilla y no se podrá enviar a la loteadora hasta que se le asigne otra.</>}
        confirmLabel="Quitar"
        onConfirm={quitar}
        pending={guardando}
      />
    </>
  );
}
