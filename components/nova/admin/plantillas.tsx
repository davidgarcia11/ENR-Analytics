"use client";

// /admin → Loteadora › Plantillas: constructor de plantillas. Una plantilla (mensaje
// de la máquina) tiene campos —uno por Field Module, con su ID de datos— y cada campo
// es una secuencia de piezas (texto, dato fijo, fresco, cocida, caducidad, turno,
// hora, línea, reloj de la máquina) que se concatenan. Modelo, formatos y
// validación en lib/loteadora-plantilla.ts; ver docs/loteadora.md §13.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight, Copy, Loader2, MoreHorizontal, Pencil, Plus, Printer, Trash2, X } from "lucide-react";
import { useApiFetch, useSession } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Label } from "@/components/nova/ui/label";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/nova/ui/dropdown-menu";
import {
  ESPACIADOS, FORMATOS_CADUCIDAD, FORMATOS_COCIDA, FORMATOS_RELOJ, INFO_PIEZA, MAX_MANUAL, TIPOS_PIEZA, componerCampos, lineasEtiqueta,
  medidasDeTamano, piezasManuales, type MedidasMensaje,
  type Campo, type Pieza, type TipoPieza, type ValoresEtiqueta,
} from "@/lib/loteadora-plantilla";
import { BotonesCopia, CabeceraSeccion, ConfirmarDialog, ErrorForm, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface Mensaje {
  id: number;
  name: string;
  campos: Campo[];
}

// En el formulario el ID se edita como texto (puede estar a medio escribir)
interface CampoEditable {
  fieldId: string;
  piezas: Pieza[];
  linea?: number;
  /** Espaciado propio del campo; sin él, el del mensaje */
  espaciado?: number;
}

// Valores de ejemplo para la vista previa: cocida hace unos días, caducidad a +30.
function valoresEjemplo(): ValoresEtiqueta {
  const hoy = new Date();
  const cocida = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 3);
  const dia = Math.floor((cocida.getTime() - new Date(cocida.getFullYear(), 0, 0).getTime()) / 86400000);
  const cad = new Date(cocida.getFullYear(), cocida.getMonth(), cocida.getDate() + 30);
  const iso = `${cad.getFullYear()}-${String(cad.getMonth() + 1).padStart(2, "0")}-${String(cad.getDate()).padStart(2, "0")}`;
  return { fresco: "263221", cocidaAnio: cocida.getFullYear(), cocidaDia: dia, caducidad: iso, hora: "0930", turno: "1", linea: "1", conReloj: true };
}
const EJEMPLO = valoresEjemplo();
// Los datos a introducir no tienen valor de ejemplo fijo: el suyo por defecto o <nombre>
const conManuales = (v: ValoresEtiqueta, campos: Campo[]): ValoresEtiqueta => ({
  ...v,
  manuales: Object.fromEntries(piezasManuales(campos).map((m) => [m.nombre, m.porDefecto || `<${m.nombre}>`])),
});

const nuevaPieza = (tipo: TipoPieza): Pieza =>
  tipo === "texto" ? { tipo, valor: "" }
    : tipo === "fijo" || tipo === "manual" ? { tipo, nombre: "", valor: "" }
      : tipo === "cocida" ? { tipo, formato: "AAJJJ" }
        : tipo === "caducidad" ? { tipo, formato: "DD/MM/AA" }
          : tipo === "reloj" ? { tipo, formato: "HHmm" }
            : { tipo };

// Plantilla nueva: arranca con un campo con la cocida (lo más habitual)
const vacia = (): CampoEditable[] => [{ fieldId: "1", piezas: [nuevaPieza("texto"), nuevaPieza("cocida")] }];

const aEditables = (campos: Campo[]): CampoEditable[] =>
  campos.map((c) => ({ fieldId: String(c.fieldId), piezas: c.piezas.map((p) => ({ ...p })), linea: c.linea ?? 1, espaciado: c.espaciado }));
const aCampos = (campos: CampoEditable[]): Campo[] =>
  campos.map((c) => ({ fieldId: Number(c.fieldId), piezas: c.piezas, linea: c.linea ?? 1, ...(c.espaciado !== undefined ? { espaciado: c.espaciado } : {}) }));
const FORMATO_ITEMS_RELOJ = FORMATOS_RELOJ.map((f) => ({ value: f, label: f }));
const LINEA_ITEMS = [1, 2, 3].map((n) => ({ value: String(n), label: `Línea ${n}` }));
const signo = (v: number) => (v > 0 ? `+${v}` : String(v));
// "" = el espaciado del mensaje (se elige al crearlo en la máquina)
const ESPACIADO_CAMPO_ITEMS = [{ value: "", label: "Espaciado del mensaje" }, ...ESPACIADOS.map((v) => ({ value: String(v), label: `Espaciado ${signo(v)}` }))];

const FORMATO_ITEMS_CAD = FORMATOS_CADUCIDAD.map((f) => ({ value: f, label: f }));
const FORMATO_ITEMS_COC = FORMATOS_COCIDA.map((f) => ({ value: f, label: f }));

// Texto con los espacios visibles: en una etiqueta un espacio de más o de menos importa
const conEspacios = (t: string) => t.replace(/ /g, "·");

function EditorPieza({ pieza, onChange, onQuitar, onMover, primera, ultima }: {
  pieza: Pieza;
  onChange: (p: Pieza) => void;
  onQuitar: () => void;
  onMover: (dir: -1 | 1) => void;
  primera: boolean;
  ultima: boolean;
}) {
  const esVariable = pieza.tipo !== "texto" && pieza.tipo !== "fijo";
  return (
    <div className={`flex items-center gap-1 rounded-lg border p-1 ${esVariable ? "bg-muted/60" : "bg-background"}`}>
      <Button type="button" variant="ghost" size="icon-xs" disabled={primera} onClick={() => onMover(-1)} aria-label="Mover a la izquierda">
        <ArrowLeft />
      </Button>
      {pieza.tipo === "texto" && (
        <Input
          value={pieza.valor ?? ""}
          onChange={(e) => onChange({ ...pieza, valor: e.target.value })}
          placeholder="texto"
          className="h-7 w-24 font-mono text-xs"
          aria-label="Texto fijo"
        />
      )}
      {pieza.tipo === "fijo" && (
        <>
          <Input value={pieza.nombre ?? ""} onChange={(e) => onChange({ ...pieza, nombre: e.target.value })} placeholder="Nombre (Precio)" className="h-7 w-28 text-xs" aria-label="Nombre del dato fijo" />
          <Input value={pieza.valor ?? ""} onChange={(e) => onChange({ ...pieza, valor: e.target.value })} placeholder="Valor" className="h-7 w-24 font-mono text-xs" aria-label="Valor del dato fijo" />
        </>
      )}
      {esVariable && <span className="px-1 text-xs font-medium text-foreground">{INFO_PIEZA[pieza.tipo].label}</span>}
      {pieza.tipo === "manual" && (
        <>
          <Input value={pieza.nombre ?? ""} onChange={(e) => onChange({ ...pieza, nombre: e.target.value })} placeholder="Lo que verá el operario" className="h-7 w-44 text-xs" aria-label="Nombre del dato a introducir" />
          <Input value={pieza.valor ?? ""} onChange={(e) => onChange({ ...pieza, valor: e.target.value })} placeholder="Por defecto (opcional)" maxLength={MAX_MANUAL} className="h-7 w-36 font-mono text-xs" aria-label="Valor por defecto" />
        </>
      )}
      {(pieza.tipo === "cocida" || pieza.tipo === "caducidad" || pieza.tipo === "reloj") && (
        <Select
          items={pieza.tipo === "cocida" ? FORMATO_ITEMS_COC : pieza.tipo === "reloj" ? FORMATO_ITEMS_RELOJ : FORMATO_ITEMS_CAD}
          value={pieza.formato}
          onValueChange={(v) => onChange({ ...pieza, formato: v as string })}
        >
          <SelectTrigger size="sm" className="h-7 w-32 font-mono text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(pieza.tipo === "cocida" ? FORMATO_ITEMS_COC : pieza.tipo === "reloj" ? FORMATO_ITEMS_RELOJ : FORMATO_ITEMS_CAD).map((f) => (
              <SelectItem key={f.value} value={f.value} className="font-mono text-xs">{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {pieza.tipo === "caducidad" && (
        <Input
          type="number"
          value={pieza.valor ?? ""}
          onChange={(e) => onChange({ ...pieza, valor: e.target.value })}
          placeholder="±días"
          title="Ajuste en días sobre la caducidad: -1 = el día anterior"
          className="h-7 w-16 font-mono text-xs"
          aria-label="Ajuste en días de la caducidad"
        />
      )}
      <Button type="button" variant="ghost" size="icon-xs" disabled={ultima} onClick={() => onMover(1)} aria-label="Mover a la derecha">
        <ArrowRight />
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onQuitar} aria-label="Quitar pieza">
        <X />
      </Button>
    </div>
  );
}

function EditorCampo({ campo, ejemplo, onChange, onQuitar, puedeQuitar }: {
  campo: CampoEditable;
  ejemplo: ValoresEtiqueta;
  onChange: (c: CampoEditable) => void;
  onQuitar: () => void;
  puedeQuitar: boolean;
}) {
  const setPiezas = (piezas: Pieza[]) => onChange({ ...campo, piezas });
  const vista = componerCampos([{ fieldId: 0, piezas: campo.piezas }], conManuales(ejemplo, [{ fieldId: 0, piezas: campo.piezas }]))[0].texto;

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <Label htmlFor={`campo-${campo.fieldId}`} className="text-xs text-muted-foreground">ID del campo</Label>
        <Input
          id={`campo-${campo.fieldId}`}
          type="number"
          min={0}
          max={255}
          value={campo.fieldId}
          onChange={(e) => onChange({ ...campo, fieldId: e.target.value })}
          className="h-8 w-20 font-mono"
        />
        <Select items={LINEA_ITEMS} value={String(campo.linea ?? 1)} onValueChange={(v) => onChange({ ...campo, linea: Number(v) })}>
          <SelectTrigger size="sm" className="h-8 w-24 text-xs" aria-label="Línea de la etiqueta"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LINEA_ITEMS.map((l) => <SelectItem key={l.value} value={l.value} className="text-xs">{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          items={ESPACIADO_CAMPO_ITEMS}
          value={campo.espaciado === undefined ? "" : String(campo.espaciado)}
          onValueChange={(v) => onChange({ ...campo, espaciado: v === "" || v === null ? undefined : Number(v) })}
        >
          <SelectTrigger size="sm" className="h-8 w-44 text-xs" aria-label="Espaciado entre caracteres del campo"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ESPACIADO_CAMPO_ITEMS.map((e) => <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Se imprime</span>
          <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-sm whitespace-pre text-foreground">
            {vista ? conEspacios(vista) : "—"}
          </code>
          {puedeQuitar && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onQuitar} aria-label="Quitar campo">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {campo.piezas.map((p, i) => (
          <EditorPieza
            key={i}
            pieza={p}
            primera={i === 0}
            ultima={i === campo.piezas.length - 1}
            onChange={(np) => setPiezas(campo.piezas.map((x, j) => (j === i ? np : x)))}
            onQuitar={() => setPiezas(campo.piezas.filter((_, j) => j !== i))}
            onMover={(dir) => {
              const arr = [...campo.piezas];
              [arr[i], arr[i + dir]] = [arr[i + dir], arr[i]];
              setPiezas(arr);
            }}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm"><Plus />Pieza</Button>} />
          <DropdownMenuContent align="start" className="w-72">
            {TIPOS_PIEZA.map((t, i) => (
              <div key={t}>
                {i === 2 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => setPiezas([...campo.piezas, nuevaPieza(t)])} className="flex-col items-start gap-0">
                  <span className="font-medium">{INFO_PIEZA[t].label}</span>
                  <span className="text-xs text-muted-foreground">{INFO_PIEZA[t].ayuda}</span>
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function AdminPlantillas({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  // Con el permiso de la sección se crea y edita; eliminar (y la copia) solo el admin.
  const esAdmin = useSession().user?.role === "admin";
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);

  const [formulario, setFormulario] = useState<"nueva" | Mensaje | null>(null);
  const [nombre, setNombre] = useState("");
  const [campos, setCampos] = useState<CampoEditable[]>(vacia);
  const [borrando, setBorrando] = useState<Mensaje | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  // La vista previa usa la línea real de la primera loteadora que la tenga
  // configurada (el envío la manda tal cual, ver loteadoras.linea).
  const [ejemplo, setEjemplo] = useState<ValoresEtiqueta>(EJEMPLO);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadora-mensajes");
      if (res.ok) setMensajes(await res.json());
    } finally { setCargando(false); }
  };

  const cargarLinea = async () => {
    const res = await apiFetch("/api/admin/loteadoras").catch(() => null);
    if (!res?.ok) return;
    const linea = ((await res.json()) as { linea: string | null }[]).find((l) => l.linea)?.linea;
    if (linea) setEjemplo({ ...EJEMPLO, linea });
  };

  useEffect(() => { cargar(); cargarLinea(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Crear en la loteadora (archivo .msg por el comando 50, ver app/api/admin/loteadora-mensajes/[id]/crear-en-maquina)
  const [enMaquina, setEnMaquina] = useState<Mensaje | null>(null);
  const [loteadoras, setLoteadoras] = useState<{ id: number; name: string }[]>([]);
  const [loteadoraId, setLoteadoraId] = useState<string | null>(null);
  const [creandoEnMaquina, setCreandoEnMaquina] = useState(false);
  // Medidas del mensaje en esa máquina: se proponen las guardadas (o las últimas de
  // esa máquina, o las de por defecto) y se guardan al crear.
  const [medidas, setMedidas] = useState<MedidasMensaje | null>(null);
  const [origenMedidas, setOrigenMedidas] = useState<"guardadas" | "maquina" | "defecto" | null>(null);
  useEffect(() => {
    if (!enMaquina || !loteadoraId) { setMedidas(null); return; }
    let vigente = true;
    apiFetch(`/api/admin/loteadora-mensajes/${enMaquina.id}/crear-en-maquina?loteadoraId=${loteadoraId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vigente && d) { setMedidas(d.medidas); setOrigenMedidas(d.origen); } })
      .catch(() => {});
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enMaquina?.id, loteadoraId]);
  // Al cambiar tamaño o espaciado se recalculan ancho y separación (se pueden retocar después)
  const cambiarMedidas = (cambio: Partial<MedidasMensaje>) => setMedidas((m) => {
    if (!m) return m;
    const nuevo = { ...m, ...cambio };
    return "tamano" in cambio || "espaciado" in cambio
      ? { ...nuevo, ...medidasDeTamano(nuevo.tamano, nuevo.espaciado, nuevo.fuente), fuente: nuevo.fuente }
      : nuevo;
  });

  const abrirCrearEnMaquina = async (m: Mensaje) => {
    setEnMaquina(m);
    if (loteadoras.length === 0) {
      const res = await apiFetch("/api/admin/loteadoras").catch(() => null);
      if (res?.ok) {
        const lista = ((await res.json()) as { id: number; name: string; enabled: number }[]).filter((l) => l.enabled);
        setLoteadoras(lista);
        // Por defecto la de pruebas, si la hay
        setLoteadoraId(String((lista.find((l) => /prueba/i.test(l.name)) ?? lista[0])?.id ?? "") || null);
      }
    }
  };

  const crearEnMaquina = async () => {
    if (!enMaquina || !loteadoraId || !medidas) return;
    setCreandoEnMaquina(true);
    try {
      const res = await apiFetch(`/api/admin/loteadora-mensajes/${enMaquina.id}/crear-en-maquina`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteadoraId: Number(loteadoraId), medidas }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "No se pudo crear en la loteadora"); return; }
      const donde = loteadoras.find((l) => String(l.id) === loteadoraId)?.name;
      toast.success(`${enMaquina.name} ${data.existia ? "sustituido" : "creado"} en ${donde}.`, { duration: 8000 });
      setEnMaquina(null);
    } catch { toast.error("Error de conexión"); } finally { setCreandoEnMaquina(false); }
  };

  const cerrar = () => { setFormulario(null); setBorrando(null); setError(""); };

  const abrirAlta = () => { setNombre(""); setCampos(vacia()); setError(""); setFormulario("nueva"); };
  const abrirEdicion = (m: Mensaje) => { setNombre(m.name); setCampos(aEditables(m.campos)); setError(""); setFormulario(m); };
  // Plantilla nueva a partir de otra: mismos campos y piezas, primer nombre libre
  // NOMBRE_2, NOMBRE_3... Los artículos asociados siguen con la original.
  const abrirDuplicado = (m: Mensaje) => {
    const usados = new Set(mensajes.map((x) => x.name));
    let n = 2;
    while (usados.has(`${m.name}_${n}`)) n++;
    setNombre(`${m.name}_${n}`); setCampos(aEditables(m.campos)); setError(""); setFormulario("nueva");
  };

  const siguienteId = () => {
    const usados = new Set(campos.map((c) => Number(c.fieldId)));
    let id = 1;
    while (usados.has(id)) id++;
    return String(id);
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
        body: JSON.stringify({ name: nombre, campos: aCampos(campos) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Error al guardar"); return; }
      toast.success(`Plantilla "${nombre}" ${esNueva ? "creada" : "actualizada"}`);
      cerrar();
      cargar();
      // Plantilla nueva: se ofrece crearla ya en la máquina (el usuario confirma)
      if (esNueva) abrirCrearEnMaquina({ id: data.id, name: data.name, campos: data.campos });
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
        {esAdmin && <BotonesCopia ruta="/api/admin/loteadora-copia" archivo="plantillas-loteadora" conPlantillas onImportado={cargar} />}
        <Button onClick={abrirAlta}>
          <Plus />
          Nueva plantilla
        </Button>
      </CabeceraSeccion>
      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">Vista previa con valores de ejemplo. El nombre debe coincidir exactamente con el mensaje creado en la máquina.</span>}
        extra={cargando ? null : `${mensajes.length} plantilla${mensajes.length === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plantilla</TableHead>
              <TableHead>Qué se imprime en cada campo</TableHead>
              <TableHead className="w-10"><span className="sr-only">Acciones</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || mensajes.length === 0 ? (
              <FilaVacia colSpan={3} cargando={cargando} texto="No hay plantillas configuradas" />
            ) : (
              mensajes.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="align-top font-mono text-sm font-medium text-foreground">{m.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {componerCampos(m.campos, conManuales(ejemplo, m.campos)).map((c) => (
                        <Badge key={c.fieldId} variant="outline" className="gap-1.5 font-normal">
                          <span className="text-muted-foreground">ID {c.fieldId}</span>
                          <span className="font-mono whitespace-pre text-foreground">{conEspacios(c.texto) || "—"}</span>
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
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
                        <DropdownMenuItem onClick={() => abrirDuplicado(m)}><Copy />Duplicar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => abrirCrearEnMaquina(m)}><Printer />Crear en la loteadora…</DropdownMenuItem>
                        {esAdmin && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setBorrando(m)}><Trash2 />Eliminar</DropdownMenuItem>
                          </>
                        )}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <form onSubmit={guardar} className="grid gap-5">
            <DialogHeader>
              <DialogTitle>{editando ? "Editar plantilla" : "Nueva plantilla"}</DialogTitle>
              <DialogDescription>
                Un campo por cada Field Module del mensaje en la máquina, con su &quot;ID de datos&quot;. Lo que se imprime en cada
                campo es la unión de sus piezas, en orden: pon como <strong>Texto</strong> lo que antes se dibujaba a mano (la
                &quot;L&quot;, &quot;CAD &quot;, espacios...). Los espacios se ven como «·».
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="m-nombre">Nombre del mensaje</Label>
              <Input id="m-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="N01_BF_FRESCO_VAR (sin .msg)" className="font-mono" autoFocus />
            </div>

            <div className="grid gap-3">
              <Label>Campos</Label>
              {campos.map((c, i) => (
                <EditorCampo
                  ejemplo={ejemplo}
                  key={i}
                  campo={c}
                  puedeQuitar={campos.length > 1}
                  onChange={(nc) => setCampos(campos.map((x, j) => (j === i ? nc : x)))}
                  onQuitar={() => setCampos(campos.filter((_, j) => j !== i))}
                />
              ))}
              <Button type="button" variant="outline" className="w-fit" onClick={() => setCampos([...campos, { fieldId: siguienteId(), piezas: [], linea: 1 }])}>
                <Plus />
                Añadir campo
              </Button>
            </div>

            <div className="grid gap-1.5">
              <Label>Así quedará en la etiqueta</Label>
              <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
                {lineasEtiqueta(aCampos(campos), conManuales(ejemplo, aCampos(campos))).join("\n") || "—"}
              </pre>
              <p className="text-xs text-muted-foreground">
                Con valores de ejemplo. «HHmm» o «HH:mm» es el reloj, que la máquina rellena con la hora real. Es la disposición con la que se crea el mensaje en la loteadora.
              </p>
            </div>

            <ErrorForm error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={cerrar}>Cancelar</Button>
              <Button type="submit" disabled={guardando || !nombre}>
                {guardando && <Loader2 className="animate-spin" />}
                {editando ? "Guardar cambios" : "Crear plantilla"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!enMaquina} onOpenChange={(o) => !o && setEnMaquina(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear en la loteadora</DialogTitle>
            <DialogDescription>
              Se crea el mensaje <span className="font-mono text-foreground">{enMaquina?.name}</span> en la máquina con esta disposición:
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
            {enMaquina ? lineasEtiqueta(enMaquina.campos, conManuales(ejemplo, enMaquina.campos)).join("\n") : ""}
          </pre>
          <div className="grid gap-1.5">
            <Label>Loteadora</Label>
            <Select items={loteadoras.map((l) => ({ value: String(l.id), label: l.name }))} value={loteadoraId} onValueChange={(v) => setLoteadoraId(v as string)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elige la loteadora" /></SelectTrigger>
              <SelectContent>
                {loteadoras.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {medidas && (
            <div className="grid gap-3 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                {origenMedidas === "guardadas" ? "Medidas con las que se creó este mensaje en esta máquina."
                  : origenMedidas === "maquina" ? "Medidas de lo último creado en esta máquina (mismo nº de líneas)."
                  : "Medidas por defecto."}{" "}
                Se guardan para la próxima vez.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="m-fuente">Fuente</Label>
                  <Input id="m-fuente" list="m-fuentes" value={medidas.fuente} onChange={(e) => cambiarMedidas({ fuente: e.target.value })} className="font-mono" />
                  <datalist id="m-fuentes"><option value="Arial" /><option value="Arial-MonoBold" /></datalist>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="m-tamano">Tamaño</Label>
                  <Input id="m-tamano" type="number" min={5} max={1200} value={medidas.tamano} onChange={(e) => cambiarMedidas({ tamano: Number(e.target.value) })} />
                </div>
                <div className="grid gap-1.5">
                  <Label title="Lo usan los campos que no tienen espaciado propio en la plantilla">Espaciado por defecto</Label>
                  <Select items={ESPACIADOS.map((v) => ({ value: String(v), label: v > 0 ? `+${v}` : String(v) }))} value={String(medidas.espaciado)} onValueChange={(v) => cambiarMedidas({ espaciado: Number(v) })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ESPACIADOS.map((v) => <SelectItem key={v} value={String(v)}>{v > 0 ? `+${v}` : v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted-foreground">Avanzado: ancho por carácter y separación entre líneas</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-ancho">Ancho por carácter (puntos)</Label>
                    <Input id="m-ancho" type="number" min={1} value={medidas.ancho} onChange={(e) => cambiarMedidas({ ancho: Number(e.target.value) })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="m-interlineado">Separación entre líneas (puntos)</Label>
                    <Input id="m-interlineado" type="number" min={1} value={medidas.interlineado} onChange={(e) => cambiarMedidas({ interlineado: Number(e.target.value) })} />
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Se calculan solos con el tamaño y el espaciado. Súbelos si los campos se montan; bájalos si quedan huecos. Arial no es de ancho fijo: es una media.
                </p>
              </details>
            </div>
          )}
          <p className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Si el mensaje ya existe en la loteadora, <strong>se sustituye entero</strong> (también lo que se le hubiera añadido a
              mano en la máquina). Imprimiendo no se puede crear.
            </span>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnMaquina(null)}>{enMaquina && !loteadoras.length ? "Cerrar" : "Ahora no"}</Button>
            <Button onClick={crearEnMaquina} disabled={creandoEnMaquina || !loteadoraId || !medidas}>
              {creandoEnMaquina && <Loader2 className="animate-spin" />}
              Crear en la loteadora
            </Button>
          </DialogFooter>
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
