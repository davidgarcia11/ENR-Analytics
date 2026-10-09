"use client";

// /admin → Integración › Claves de API: las claves con las que llaman al dashboard
// los sistemas externos. Crear, editar, rotar, revocar y eliminar, con
// caducidad opcional. Solo admin. La clave completa se enseña una sola vez, al
// crearla o rotarla; después solo su prefijo. Lógica en lib/api-claves.ts; ver
// docs/api-integracion.md.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Ban, Check, Copy, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Textarea } from "@/components/nova/ui/textarea";
import { Badge } from "@/components/nova/ui/badge";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import { CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";
// Solo tipos: lib/api-claves usa crypto del servidor. El estado lo calcula el servidor.
import type { ClaveApi as ClaveBd, Entorno, EstadoClave, FinVieja } from "@/lib/api-claves";

type ClaveApi = ClaveBd & { estado: EstadoClave };

type Ambitos = Record<string, { label: string; ruta: string }>;

const ESTADO = {
  activa: { label: "Activa", className: "bg-emerald-400/10 text-emerald-600" },
  caducada: { label: "Caducada", className: "bg-muted text-muted-foreground" },
  revocada: { label: "Revocada", className: "bg-rose-400/10 text-rose-500" },
};
const ENTORNO_ITEMS = [{ value: "prueba", label: "De prueba (enr_test_…)" }, { value: "real", label: "Real (enr_live_…)" }];
const FIN_ITEMS = [{ value: "7", label: "7 días más" }, { value: "1", label: "1 día más" }, { value: "ahora", label: "Nada: revocarla ya" }];

// Fechas UTC de la BD ("AAAA-MM-DD HH:MM:SS") en hora local
const fechaHora = (utc: string | null) => utc
  ? new Date(utc.replace(" ", "T") + "Z").toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
  : null;
// "AAAA-MM-DD" → "DD/MM/AAAA"
const fecha = (iso: string) => iso.split("-").reverse().join("/");
const hoy = () => new Date().toLocaleDateString("sv-SE");
const enDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString("sv-SE");

export default function AdminApiClaves({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [claves, setClaves] = useState<ClaveApi[]>([]);
  const [ambitos, setAmbitos] = useState<Ambitos>({});
  const [cargando, setCargando] = useState(true);

  // Formulario de alta/edición
  const [formulario, setFormulario] = useState<"nueva" | ClaveApi | null>(null);
  const [nombre, setNombre] = useState("");
  const [entorno, setEntorno] = useState<Entorno>("prueba");
  const [ambitosSel, setAmbitosSel] = useState<string[]>([]);
  const [caducaEl, setCaducaEl] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Clave recién creada o rotada: se enseña una sola vez
  const [nuevaClave, setNuevaClave] = useState<{ clave: string; nombre: string } | null>(null);
  const [copiada, setCopiada] = useState(false);
  const campoClave = useRef<HTMLInputElement>(null);
  const [rotando, setRotando] = useState<ClaveApi | null>(null);
  const [finVieja, setFinVieja] = useState<FinVieja>("7");
  const [revocando, setRevocando] = useState<ClaveApi | null>(null);
  const [borrando, setBorrando] = useState<ClaveApi | null>(null);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/api-claves");
      if (res.ok) { const d = await res.json(); setClaves(d.claves); setAmbitos(d.ambitos); }
    } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const cerrar = () => { setFormulario(null); setRotando(null); setRevocando(null); setBorrando(null); setError(""); };
  const abrir = (c: ClaveApi | "nueva") => {
    setNombre(c === "nueva" ? "" : c.nombre);
    setEntorno(c === "nueva" ? "prueba" : c.entorno);
    setAmbitosSel(c === "nueva" ? Object.keys(ambitos) : c.ambitos);
    setCaducaEl(c === "nueva" ? "" : c.caducaEl ?? "");
    setNotas(c === "nueva" ? "" : c.notas ?? "");
    setError("");
    setFormulario(c);
  };

  // Llamada común: devuelve el JSON si fue bien; si no, el error al formulario o a un aviso
  const llamar = async (url: string, metodo: string, body?: unknown, enFormulario = false) => {
    setGuardando(true); setError("");
    try {
      const res = await apiFetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) { if (enFormulario) setError(data.error || "Error"); else toast.error(data.error || "Error"); return null; }
      return data;
    } catch {
      if (enFormulario) setError("Error de conexión"); else toast.error("Error de conexión");
      return null;
    } finally { setGuardando(false); }
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formulario) return;
    const datos = { nombre, ambitos: ambitosSel, caducaEl: caducaEl || null, notas };
    if (formulario === "nueva") {
      const r = await llamar("/api/admin/api-claves", "POST", { ...datos, entorno }, true);
      if (!r) return;
      cerrar();
      setNuevaClave({ clave: r.clave, nombre: r.fila.nombre }); setCopiada(false);
    } else {
      if (!await llamar(`/api/admin/api-claves/${formulario.id}`, "PATCH", datos, true)) return;
      toast.success(`Clave "${nombre}" actualizada`);
      cerrar();
    }
    cargar();
  };

  const rotar = async () => {
    if (!rotando) return;
    const r = await llamar(`/api/admin/api-claves/${rotando.id}/rotar`, "POST", { fin: finVieja });
    if (!r) return;
    cerrar();
    setNuevaClave({ clave: r.clave, nombre: r.fila.nombre }); setCopiada(false);
    cargar();
  };

  const revocar = async () => {
    if (!revocando || !await llamar(`/api/admin/api-claves/${revocando.id}`, "PATCH", { revocar: true })) return;
    toast.success(`Clave "${revocando.nombre}" revocada`);
    cerrar(); cargar();
  };

  const borrar = async () => {
    if (!borrando || !await llamar(`/api/admin/api-claves/${borrando.id}`, "DELETE")) return;
    toast.success(`Clave "${borrando.nombre}" eliminada`);
    cerrar(); cargar();
  };

  // El portapapeles moderno (navigator.clipboard) solo existe en páginas seguras (https o
  // localhost). Por http en la red interna se usa el método clásico: seleccionar el campo
  // y copiar (execCommand, obsoleto pero el único que funciona sin https).
  const copiar = async () => {
    if (!nuevaClave) return;
    try {
      if (window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(nuevaClave.clave);
      } else {
        const campo = campoClave.current;
        campo?.focus();
        campo?.select();
        if (!campo || !document.execCommand("copy")) throw new Error();
      }
      setCopiada(true);
    } catch { toast.error("No se pudo copiar: selecciónala y cópiala a mano"); }
  };

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <Button onClick={() => abrir("nueva")}><Plus />Nueva clave</Button>
      </CabeceraSeccion>
      <TablaCard
        toolbar={
          <span className="text-sm text-muted-foreground">
            Van en la cabecera <code className="font-mono">x-api-key</code>. Las de prueba solo guardan lo recibido, marcado como prueba. La clave completa solo se ve al crearla o rotarla.
          </span>
        }
        extra={cargando ? null : `${claves.length} clave${claves.length === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Clave</TableHead>
              <TableHead>Da acceso a</TableHead>
              <TableHead>Caduca</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || claves.length === 0 ? (
              <FilaVacia colSpan={7} cargando={cargando} texto="No hay claves. Crea una para que un sistema externo pueda llamar a la API." />
            ) : (
              claves.map((c) => {
                const estado = c.estado;
                // Avisa si caduca en los próximos 7 días
                const caducaPronto = estado === "activa" && c.caducaEl && c.caducaEl <= enDias(7);
                return (
                  <TableRow key={c.id} className="align-top">
                    <TableCell>
                      <span className="block font-medium text-foreground">{c.nombre}</span>
                      {c.notas && <span className="block max-w-64 text-xs text-muted-foreground">{c.notas}</span>}
                      <span className="block text-xs text-muted-foreground">Creada {fechaHora(c.creadaAt)}{c.creadaPor ? ` por ${c.creadaPor}` : ""}</span>
                    </TableCell>
                    <TableCell>
                      <span className="block font-mono text-sm">{c.prefijo}…</span>
                      <Badge variant="outline" className="mt-1 font-normal">{c.entorno === "real" ? "Real" : "Prueba"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.ambitos.map((a) => <span key={a} className="block" title={ambitos[a]?.ruta}>{ambitos[a]?.label ?? a}</span>)}
                    </TableCell>
                    <TableCell className={`whitespace-nowrap text-sm ${caducaPronto ? "font-medium text-amber-600" : ""}`}>
                      {c.caducaEl ? fecha(c.caducaEl) : <span className="text-muted-foreground">Sin caducidad</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {c.ultimoUsoAt
                        ? <>{fechaHora(c.ultimoUsoAt)}{c.ultimoUsoIp && <span className="block text-xs text-muted-foreground" title="IP que declara la petición (x-forwarded-for): orientativa, no comprobada">{c.ultimoUsoIp}</span>}</>
                        : <span className="text-muted-foreground">Nunca</span>}
                    </TableCell>
                    <TableCell>
                      <Badge className={ESTADO[estado].className}>{ESTADO[estado].label}</Badge>
                      {c.revocadaAt && <span className="mt-1 block text-xs text-muted-foreground">{fechaHora(c.revocadaAt)}{c.revocadaPor ? ` por ${c.revocadaPor}` : ""}</span>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Acciones de ${c.nombre}`}><MoreHorizontal /></Button>} />
                        <DropdownMenuContent align="end" className="min-w-44">
                          {estado !== "revocada" && <DropdownMenuItem onClick={() => abrir(c)}><Pencil />Editar</DropdownMenuItem>}
                          {estado === "activa" && <DropdownMenuItem onClick={() => { setFinVieja("7"); setRotando(c); }}><RefreshCw />Rotar…</DropdownMenuItem>}
                          {estado === "activa" && <DropdownMenuItem variant="destructive" onClick={() => setRevocando(c)}><Ban />Revocar</DropdownMenuItem>}
                          {estado !== "activa" && (
                            <>
                              {estado === "caducada" && <DropdownMenuSeparator />}
                              <DropdownMenuItem variant="destructive" onClick={() => setBorrando(c)}><Trash2 />Eliminar</DropdownMenuItem>
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

      {/* Alta y edición */}
      <Dialog open={!!formulario} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={guardar} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{formulario === "nueva" ? "Nueva clave de API" : "Editar clave"}</DialogTitle>
              <DialogDescription>
                {formulario === "nueva"
                  ? "Para un sistema externo concreto. La clave completa se enseñará una sola vez al crearla."
                  : "La clave no cambia. Para cambiarla, usa Rotar."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="k-nombre">Nombre</Label>
              <Input id="k-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="ERP pruebas" maxLength={60} autoFocus />
            </div>
            {formulario === "nueva" && (
              <div className="grid gap-2">
                <Label>Entorno</Label>
                <Select items={ENTORNO_ITEMS} value={entorno} onValueChange={(v) => setEntorno((v as Entorno) ?? "prueba")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENTORNO_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">Lo que llegue con una clave de prueba se guarda marcado y nunca se procesará.</span>
              </div>
            )}
            <div className="grid gap-2">
              <Label>Da acceso a</Label>
              {Object.entries(ambitos).map(([clave, a]) => (
                <label key={clave} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={ambitosSel.includes(clave)}
                    onCheckedChange={(v) => setAmbitosSel((s) => (v === true ? [...s, clave] : s.filter((x) => x !== clave)))}
                  />
                  <span>{a.label} <span className="block font-mono text-xs text-muted-foreground">{a.ruta}</span></span>
                </label>
              ))}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-caduca">Caduca</Label>
              <div className="flex items-center gap-2">
                <Input id="k-caduca" type="date" min={hoy()} value={caducaEl} onChange={(e) => setCaducaEl(e.target.value)} className="w-44" />
                {caducaEl && <Button type="button" variant="ghost" size="sm" onClick={() => setCaducaEl("")}>Sin caducidad</Button>}
              </div>
              <span className="text-xs text-muted-foreground">{caducaEl ? `Vale hasta el ${fecha(caducaEl)} incluido.` : "Sin fecha: vale hasta que se revoque."}</span>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="k-notas">Notas</Label>
              <Textarea id="k-notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Quién la usa, para qué, contacto…" maxLength={300} rows={2} />
            </div>
            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !nombre.trim() || ambitosSel.length === 0}>
                {guardando && <Loader2 className="animate-spin" />}
                {formulario === "nueva" ? "Crear clave" : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* La clave nueva, una sola vez */}
      <Dialog open={!!nuevaClave} onOpenChange={(o) => !o && setNuevaClave(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="size-5" />Clave «{nuevaClave?.nombre}»</DialogTitle>
            <DialogDescription>Cópiala ahora y pásala por un canal privado. Al cerrar esta ventana no se podrá volver a ver.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input ref={campoClave} readOnly value={nuevaClave?.clave ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Clave de API" />
            <Button type="button" variant="outline" onClick={copiar}>{copiada ? <Check /> : <Copy />}{copiada ? "Copiada" : "Copiar"}</Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNuevaClave(null)}>Ya la he copiado</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotar */}
      <Dialog open={!!rotando} onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rotar «{rotando?.nombre}»</DialogTitle>
            <DialogDescription>
              Se crea una clave nueva con la misma configuración. Mientras el sistema que la usa la cambia, ¿cuánto sigue valiendo la actual?
            </DialogDescription>
          </DialogHeader>
          <Select items={FIN_ITEMS} value={finVieja} onValueChange={(v) => setFinVieja((v as FinVieja) ?? "7")}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FIN_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
            <Button onClick={rotar} disabled={guardando}>{guardando && <Loader2 className="animate-spin" />}Rotar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmarDialog
        open={!!revocando}
        onOpenChange={(o) => !o && cerrar()}
        title="Revocar clave"
        description={<>La clave «{revocando?.nombre}» dejará de valer al momento y no se puede deshacer. Quien la use recibirá «Clave no válida».</>}
        confirmLabel="Revocar"
        onConfirm={revocar}
        pending={guardando}
      />
      <ConfirmarDialog
        open={!!borrando}
        onOpenChange={(o) => !o && cerrar()}
        title="Eliminar clave"
        description={<>Se borra la clave «{borrando?.nombre}» de la lista. Los mensajes recibidos con ella se conservan, con su nombre.</>}
        onConfirm={borrar}
        pending={guardando}
      />
    </>
  );
}
