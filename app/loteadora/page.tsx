"use client";

// Panel operativo de la loteadora — rediseño sobre el sistema Nova (ShadcnSpace).
// Primer panel Nova puramente de formulario (sin tabla/KPI numérico) y primero en
// necesitar un desplegable con búsqueda por texto (Combobox) — ver
// components/nova/README.md para el detalle de ambos patrones nuevos.
// La lógica de negocio (cálculo de lote/cocida/caducidad, protocolo TIJ, plantillas
// por artículo) es la misma que la versión anterior — ver docs/loteadora.md.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  AlertTriangle,
  Calendar as CalendarIcon,
  Printer,
  PowerOff,
  Upload,
  Eraser,
  RefreshCw,
} from "lucide-react";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso } from "@/lib/permisos";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Alert, AlertDescription } from "@/components/nova/ui/alert";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Input } from "@/components/nova/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/nova/ui/combobox";
import { Toaster } from "@/components/nova/ui/sonner";
import {
  INFO_PIEZA, MAX_MANUAL, aplicarAjusteTurno, componerCampos, diasPorTurno, piezasManuales, variablesUsadas,
  type AjusteTurno, type Campo, type TipoVariable,
} from "@/lib/loteadora-plantilla";

// Plantilla del artículo: nombre del mensaje en la máquina y sus campos con piezas
// (lib/loteadora-plantilla.ts) — deciden qué pide el formulario y la vista previa.
// ultimosManuales: último valor enviado de cada "dato a introducir" de la plantilla
interface PlantillaArticulo { messageName: string; campos: Campo[]; ultimosManuales: Record<string, string>; ajusteTurno: AjusteTurno | null }
interface Articulo { id: string; descripcion: string; diasCaducidad: number; familia: string; familiaDesc: string; plantilla: PlantillaArticulo | null }
// familias: códigos F4101.IMSRP2 separados por comas que ofrece esta loteadora (vacío = todas)
interface Loteadora { id: number; name: string; linea: string; familias: string; zona: string | null }
type EstadoLoteadoraValor = "activa" | "en_error" | "standby" | "apagada";
// ultimoEnvio: lo último que mandó el panel a esa máquina (no lo que tenga si se cambió a mano)
// `lineas`: lo enviado colocado como en la etiqueta; los trozos `reloj` no se envían (los pone la máquina)
interface UltimoEnvio { plantilla: string; lineas: { texto: string; reloj?: boolean }[][]; usuario: string | null; enviadoAt: string }
// `motivo`: solo si no responde, por qué (tiempo agotado, rechaza o cierra la conexión...)
interface EstadoLoteadora { id: number; name: string; zona: string | null; state: EstadoLoteadoraValor; motivo?: string; ultimoEnvio: UltimoEnvio | null }

// Formulario de UN trabajo de impresión (artículo/fechas/turno/plantilla elegida).
// Se guarda uno por loteadora (ver `formStates` en el componente) para que cambiar
// de loteadora no mezcle ni pierda lo que había en cada una.
interface LoteadoraFormState {
  selectedArticuloId: string | null;
  // Lote (antes "fabricación"): texto libre tal cual lo escribe el operario
  // (ej. "263221", a veces con el turno al final) — se envía sin tocar, no se
  // calcula. Ver "Lote Fresco" en la UI y docs/loteadora.md §5.
  loteManual: string;
  // Cocida: solo el día juliano (1-366); el año se infiere (resolveCocidaYear).
  cocidaJulianDay: string;
  diasCad: string;
  diasDesdeJde: number | null;
  modoManual: boolean;
  turno: string;
  // "artículo|plantilla" para el que ya se preguntó si cargar la plantilla en
  // ESTA loteadora: al volver a ella no se vuelve a preguntar (recargar el
  // mensaje podría borrar los datos ya enviados que esperan para imprimir).
  plantillaPreguntada: string | null;
  // Datos a introducir de la plantilla (pieza 'manual'), por nombre
  manuales: Record<string, string>;
}

// Colores fijos (enum cerrado de 4 estados) — mismo formato "bg-x/10 text-x" que el
// resto de indicadores de estado en Nova (ver components/nova/mrp-materials-table.tsx).
// Imprimiendo en ámbar: mientras imprime no se puede cambiar nada (aviso); conectada
// y parada, en verde: lista para cambiar de plantilla o enviar.
const ESTADO_INFO: Record<EstadoLoteadoraValor, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  activa: { label: "Imprimiendo", className: "bg-amber-400/10 text-amber-600", icon: Printer },
  en_error: { label: "En error", className: "bg-rose-400/10 text-rose-500", icon: XCircle },
  standby: { label: "Conectada", className: "bg-emerald-400/10 text-emerald-600", icon: CheckCircle2 },
  apagada: { label: "Sin conexión", className: "bg-muted text-muted-foreground", icon: PowerOff },
};

// --- Utilidades de cálculo ---
function toJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}
// Reconstruye una fecha real a partir de año + día juliano (inverso de toJulianDay).
function fromJulianDay(year: number, day: number): Date {
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + day - 1);
  return d;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
// "2026-09-24 08:35:12" (UTC, CURRENT_TIMESTAMP de SQLite) → "10:35" hoy, "23/09 10:35" otro día
function cuandoEnvio(utc: string): string {
  const d = new Date(utc.replace(" ", "T") + "Z");
  const hora = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })} ${hora}`;
}
function toHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}
// La cocida se introduce solo como día juliano (1-366): el año no lo escribe
// el operario, se infiere. Si el día introducido es POSTERIOR al día juliano
// de hoy, es que pertenece al año que acaba de terminar (ej. hoy 2 de enero,
// cocida día 364 → año anterior, no el actual — ver docs/loteadora.md §5).
function resolveCocidaYear(julianDay: number, today: Date): number {
  const todayJulian = toJulianDay(today);
  return julianDay > todayJulian ? today.getFullYear() - 1 : today.getFullYear();
}
function defaultFormState(): LoteadoraFormState {
  return {
    selectedArticuloId: null,
    loteManual: "",
    cocidaJulianDay: "",
    diasCad: "",
    diasDesdeJde: null,
    modoManual: false,
    turno: "",
    plantillaPreguntada: null,
    manuales: {},
  };
}

function LoteadoraPanel() {
  // Sesión, logout y el manejo del 401 vienen del provider compartido
  // (components/SessionProvider.tsx) — antes cada panel se los montaba aparte.
  const { user: sessionUser, logout } = useSession();
  const apiFetch = useApiFetch();

  const [mode, setMode] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const effectiveTheme = mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
  const portalContainerRef = useRef<HTMLDivElement>(null);

  // Selección de artículo (búsqueda directa, sin marca)
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [loadingArticulos, setLoadingArticulos] = useState(false);

  // Formulario — uno POR LOTEADORA (clave = selectedLoteadora, "" = todavía sin
  // elegir ninguna), para que cambiar de loteadora no mezcle ni pierda lo que
  // había en cada una. Ver "Sesión por loteadora" en docs/loteadora.md §14.
  const [formStates, setFormStates] = useState<Record<string, LoteadoraFormState>>({});

  // Estado JDE
  const [jdeOnline, setJdeOnline] = useState(true);

  // Loteadora de destino
  const [loteadoras, setLoteadoras] = useState<Loteadora[]>([]);
  const [selectedLoteadora, setSelectedLoteadora] = useState("");
  const [estadoLoteadoras, setEstadoLoteadoras] = useState<EstadoLoteadora[]>([]);
  const [loadingEstado, setLoadingEstado] = useState(false);
  const [limpiandoBuffer, setLimpiandoBuffer] = useState(false);

  const [cargandoMensaje, setCargandoMensaje] = useState(false);

  // Formulario activo: el de la loteadora seleccionada ahora mismo (o el
  // "borrador" sin loteadora todavía, clave "").
  const currentForm = formStates[selectedLoteadora] ?? defaultFormState();
  const { loteManual, cocidaJulianDay, diasCad, diasDesdeJde, modoManual, turno } = currentForm;
  const selectedArticulo = articulos.find((a) => a.id === currentForm.selectedArticuloId) ?? null;
  const updateForm = (patch: Partial<LoteadoraFormState>) => {
    setFormStates((prev) => ({
      ...prev,
      [selectedLoteadora]: { ...(prev[selectedLoteadora] ?? defaultFormState()), ...patch },
    }));
  };
  // Solo dígitos — ambos campos son numéricos (ver anotaciones de David: lote
  // hasta 6 caracteres, cocida hasta 3).
  const setLoteManual = (v: string) => updateForm({ loteManual: v.replace(/\D/g, "").slice(0, 6) });
  const setCocidaJulianDay = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 3);
    // El día juliano no puede superar 366 — si escriben más, se tope ahí (el
    // mínimo válido, 1, ya lo exige cocidaValida al calcular/enviar).
    const num = parseInt(digits, 10);
    updateForm({ cocidaJulianDay: !isNaN(num) && num > 366 ? "366" : digits });
  };
  const setDiasCad = (v: string) => updateForm({ diasCad: v });
  const setModoManual = (v: boolean) => updateForm({ modoManual: v });
  const setTurno = (v: string) => updateForm({ turno: v });

  // Hora de envío (HHmm): reloj en vivo, no editable — se manda tal cual esté
  // en el instante exacto de pulsar "Enviar".
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Confirmación antes de tocar la máquina (cargar la plantilla de un artículo o
  // enviar datos): un solo diálogo, con la acción a ejecutar si se acepta y, si
  // hace falta, qué deshacer si se cancela.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string; detalle: React.ReactNode; boton: string; accion: () => void; alCancelar?: () => void;
  } | null>(null);
  const cancelarConfirmacion = () => { confirmacion?.alCancelar?.(); setConfirmacion(null); };

  // Formulario tal como estaba antes de elegir un artículo: si se cancela la carga de
  // su plantilla, se vuelve a él (sin artículo, o el artículo y los datos de antes).
  const antesDelArticulo = useRef<{ loteadora: string; articuloId: string; form: LoteadoraFormState } | null>(null);

  // Envío
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null);
  const [showSendErrorDetail, setShowSendErrorDetail] = useState(false);

  useEffect(() => {
    fetchArticulos();
    fetchLoteadoras();
    fetchEstadoLoteadoras();

    // Estado en vivo: JDE y loteadoras se refrescan solos cada 60s mientras
    // el panel esté abierto (cada comprobación de loteadora abre y cierra
    // una conexión TCP breve — protocolo TIJ, comando 14).
    const interval = setInterval(() => {
      fetchArticulos();
      fetchEstadoLoteadoras();
    }, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedLoteadora) return;
    // Se refresca el estado en vivo justo aquí (no solo cada 60s) para que el
    // aviso de "está imprimiendo" corresponda a la loteadora recién elegida.
    fetchEstadoLoteadoras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoteadora]);

  // Autocarga de plantilla: si el artículo elegido (para ESTA loteadora, ver
  // formStates) tiene una plantilla asociada, se pide confirmación para
  // cargarla. Dependencias por valor (id/messageName), no por el objeto
  // `selectedArticulo` entero — ese objeto cambia de referencia cada vez que
  // se refresca `articulos` (cada 60s) aunque el contenido sea el mismo, y
  // dispararía una recarga innecesaria en la loteadora cada minuto.
  // Si la loteadora está imprimiendo no se carga (se avisa): se carga con
  // "Volver a cargar" cuando la paren. El nombre lo comprueba el servidor.
  useEffect(() => {
    if (!selectedLoteadora || !selectedArticulo?.plantilla) return;
    const nombre = selectedArticulo.plantilla.messageName;
    // Solo al cambiar de artículo (o de su plantilla), no al volver a esta loteadora.
    const clave = `${selectedArticulo.id}|${nombre}`;
    if (currentForm.plantillaPreguntada === clave) return;
    updateForm({ plantillaPreguntada: clave });
    if (imprimiendo) {
      toast.warning(`La loteadora está imprimiendo: no se ha cargado ${nombre}. Para la impresión y pulsa "Volver a cargar".`);
      return;
    }
    const antes = antesDelArticulo.current;
    const deshacer = antes && antes.loteadora === selectedLoteadora && antes.articuloId === selectedArticulo.id ? antes : null;
    setConfirmacion({
      titulo: "Cambiar la plantilla de la loteadora",
      detalle: <>Se cargará <span className="font-mono font-medium text-foreground">{nombre}</span> en <span className="font-medium text-foreground">{loteadoraSeleccionada?.name}</span> para el artículo <span className="font-medium text-foreground">{selectedArticulo.id} — {selectedArticulo.descripcion}</span>.</>,
      boton: "Cargar plantilla",
      accion: () => cargarMensaje(nombre),
      alCancelar: deshacer ? () => setFormStates((prev) => ({ ...prev, [deshacer.loteadora]: deshacer.form })) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArticulo?.id, selectedArticulo?.plantilla?.messageName, selectedLoteadora]);

  // También sirve como comprobación de vida de JDE (badge "JDE conectado"),
  // por eso se repite cada 60s junto al resto del estado en vivo — no toca la
  // selección de artículo ya hecha, solo refresca la lista disponible.
  const fetchArticulos = async () => {
    setLoadingArticulos(true);
    try {
      const res = await fetch("/api/loteadora/articulos");
      if (!res.ok) throw new Error();
      setArticulos(await res.json());
      setJdeOnline(true);
    } catch {
      setJdeOnline(false);
      setArticulos([]);
    } finally {
      setLoadingArticulos(false);
    }
  };

  const fetchLoteadoras = async () => {
    try {
      const res = await fetch("/api/loteadora/impresoras");
      if (!res.ok) throw new Error();
      setLoteadoras(await res.json());
    } catch {
      setLoteadoras([]);
    }
  };

  const fetchEstadoLoteadoras = async () => {
    setLoadingEstado(true);
    try {
      const res = await fetch("/api/loteadora/estado");
      if (!res.ok) throw new Error();
      setEstadoLoteadoras(await res.json());
    } catch {
      setEstadoLoteadoras([]);
    } finally {
      setLoadingEstado(false);
    }
  };

  const cargarMensaje = async (messageName: string) => {
    // Sin bloquear si ya hay una carga en curso: la cola de lib/loteadora-printer
    // las ejecuta en orden (antes la segunda se ignoraba en silencio).
    if (!selectedLoteadora || !messageName) return;
    setCargandoMensaje(true);
    try {
      const res = await apiFetch("/api/loteadora/cargar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteadoraId: Number(selectedLoteadora), messageName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar la plantilla");
      if (data.warning) toast.warning(data.warning);
      else toast.success("Plantilla cargada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al cargar la plantilla");
    } finally {
      setCargandoMensaje(false);
    }
  };

  const handleCargarMensaje = () => selectedArticulo?.plantilla && cargarMensaje(selectedArticulo.plantilla.messageName);

  const handleLimpiarBuffer = async () => {
    if (!selectedLoteadora || limpiandoBuffer) return;
    setLimpiandoBuffer(true);
    try {
      const res = await apiFetch("/api/loteadora/limpiar-buffer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteadoraId: Number(selectedLoteadora) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al limpiar el buffer");
      toast.success("Buffer de campos remotos vaciado");
    } catch (err: any) {
      toast.error(err.message || "Error al limpiar el buffer");
    } finally {
      setLimpiandoBuffer(false);
    }
  };

  const handleArticuloChange = (id: string | null) => {
    const art = articulos.find((a) => a.id === id) ?? null;
    if (art) antesDelArticulo.current = { loteadora: selectedLoteadora, articuloId: art.id, form: currentForm };
    if (!art) {
      updateForm({ selectedArticuloId: null, plantillaPreguntada: null });
      return;
    }
    // Otro artículo puede ser otra tirada (otra cocida, otro lote): se vacían Lote
    // Fresco, Juliano Cocida y Turno para no enviar los del anterior. Los datos a
    // introducir se proponen con el último valor enviado con esa plantilla (o su
    // valor por defecto). Cambiar de loteadora no toca nada (cada una su formulario).
    const manuales = Object.fromEntries(
      piezasManuales(art.plantilla?.campos ?? []).map((m) => [m.nombre, art.plantilla?.ultimosManuales?.[m.nombre] ?? m.porDefecto]),
    );
    updateForm({
      selectedArticuloId: art.id,
      loteManual: "",
      cocidaJulianDay: "",
      turno: "",
      manuales,
      ...(art.diasCaducidad > 0
        ? { diasDesdeJde: art.diasCaducidad, diasCad: String(art.diasCaducidad), modoManual: false }
        : { diasDesdeJde: null, diasCad: "", modoManual: true }),
    });
  };

  // Al elegir una loteadora que aún no tenga su propia sesión: si venías del
  // "borrador" sin loteadora (flujo normal: rellenar el formulario y luego
  // elegir a dónde enviarlo), se la queda esa loteadora. Si ya tenías otra
  // loteadora elegida y cambias a una tercera sin visitar, empieza en blanco
  // — cada loteadora tiene su propia sesión independiente, no hereda de la
  // que tuvieras abierta un momento antes.
  const handleLoteadoraSelect = (id: string) => {
    setFormStates((prev) => {
      if (prev[id]) return prev;
      const seed = selectedLoteadora === "" ? (prev[""] ?? defaultFormState()) : defaultFormState();
      return { ...prev, [id]: seed };
    });
    setSelectedLoteadora(id);
    // El error de envío es de la loteadora que se acaba de dejar — mostrarlo
    // sobre la sesión de otra loteadora sería confuso.
    setSendError(null);
    setSendErrorDetail(null);
    setShowSendErrorDetail(false);
  };

  const pedirConfirmacionEnvio = () => {
    if (!canSend) return;
    setConfirmacion({
      titulo: "Enviar a la loteadora",
      detalle: (
        <>
          Se enviará a <span className="font-medium text-foreground">{loteadoraSeleccionada?.name}</span>:
          {avisoTurno && <span className="mt-1 block text-xs font-medium text-amber-600">{avisoTurno}</span>}
          <span className="mt-2 grid gap-1">
            {compuestos.map((c) => (
              <span key={c.fieldId} className="flex gap-2 font-mono text-sm text-foreground">
                <span className="w-16 shrink-0 text-muted-foreground">Campo {c.fieldId}</span>
                <span className="whitespace-pre">{c.texto}</span>
              </span>
            ))}
          </span>
        </>
      ),
      boton: "Enviar",
      accion: handleEnviar,
    });
  };

  const handleEnviar = async () => {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    setSendErrorDetail(null);
    setShowSendErrorDetail(false);
    try {
      const res = await apiFetch("/api/loteadora/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loteadoraId: Number(selectedLoteadora),
          articuloId: selectedArticulo?.id,
          articuloDesc: selectedArticulo?.descripcion, // solo para el registro de envíos
          // Valores en crudo: el texto de cada campo lo compone el servidor con la
          // plantilla del artículo (el mismo cálculo que la vista previa).
          fresco: lote,
          cocidaAnio: cocidaYear,
          cocidaDia: cocidaValida ? cocidaDiaNum : null,
          caducidad: fechaCaducidad ? toISODate(fechaCaducidad) : null,
          horaEnvio: toHHmm(new Date()),
          turno,
          manuales: currentForm.manuales,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error || "Error al enviar a la loteadora");
        setSendErrorDetail(data.detail || null);
        return;
      }
      if (data.warning) {
        toast.warning(`Enviado, pero con aviso: ${data.warning}`, { duration: 8000 });
      } else {
        toast.success("Mensaje enviado correctamente");
      }
      fetchEstadoLoteadoras(); // para ver ya el último envío en el estado
    } catch (err: any) {
      setSendError(err.message || "Error al enviar a la loteadora");
    } finally {
      setSending(false);
    }
  };

  // Cálculos derivados
  const lote = loteManual.trim() || null; // se envía tal cual, sin transformar
  const cocidaDiaNum = parseInt(cocidaJulianDay, 10);
  const cocidaValida = !isNaN(cocidaDiaNum) && cocidaDiaNum >= 1 && cocidaDiaNum <= 366;
  const cocidaYear = cocidaValida ? resolveCocidaYear(cocidaDiaNum, ahora) : null;
  const cocidaAnioAnterior = cocidaValida && cocidaYear !== ahora.getFullYear();
  const cocida = cocidaValida ? `${String(cocidaYear).slice(-2)}${String(cocidaDiaNum).padStart(3, "0")}` : null;
  const diasNum = parseInt(diasCad, 10);
  const fechaCaducidad =
    cocidaValida && cocidaYear !== null && !isNaN(diasNum) && diasNum > 0
      ? addDays(fromJulianDay(cocidaYear, cocidaDiaNum), diasNum)
      : null;
  const loteadoraSeleccionada = loteadoras.find((l) => String(l.id) === selectedLoteadora) ?? null;
  const lineaLoteadora = loteadoraSeleccionada?.linea || null;

  // Lo que pide el formulario depende de la plantilla del artículo: sin artículo (o
  // sin plantilla) se enseña todo; con plantilla, solo lo que usan sus campos.
  const plantilla = selectedArticulo?.plantilla ?? null;
  const usadas = plantilla ? variablesUsadas(plantilla.campos, plantilla.ajusteTurno) : null;
  const necesita = (t: TipoVariable) => !usadas || usadas.has(t);
  // Caducidad según el turno (de la plantilla): la vista previa la enseña ya movida,
  // igual que la calculará el servidor (a la caducidad se le manda sin el ajuste).
  const diasTurno = diasPorTurno(plantilla?.ajusteTurno, turno || undefined);
  const avisoTurno = diasTurno ? `Caducidad ${diasTurno > 0 ? "+" : ""}${diasTurno} día${Math.abs(diasTurno) === 1 ? "" : "s"} por el turno ${turno}` : null;
  const compuestos = plantilla
    ? componerCampos(plantilla.campos, aplicarAjusteTurno({
        fresco: lote ?? undefined,
        cocidaAnio: cocidaYear ?? undefined,
        cocidaDia: cocidaValida ? cocidaDiaNum : undefined,
        caducidad: fechaCaducidad ? toISODate(fechaCaducidad) : undefined,
        hora: toHHmm(ahora),
        turno: turno || undefined,
        manuales: currentForm.manuales,
        linea: lineaLoteadora ?? undefined,
      }, plantilla.ajusteTurno))
    : [];
  const faltan = [...new Set(compuestos.flatMap((c) => c.faltan))];
  // Imprimiendo (P_Status 00 en el estado en vivo) no se deja cambiar nada, ni de
  // artículo (se bloquea el desplegable); el
  // servidor lo vuelve a comprobar en el momento (el estado aquí puede tener 60s).
  const estadoDe = (id: string) => estadoLoteadoras.find((e) => String(e.id) === id)?.state;
  const imprimiendo = estadoDe(selectedLoteadora) === "activa";
  // Sin conexión no se puede elegir en el desplegable; si la elegida se desconecta
  // después, se avisa y se bloquea igual que imprimiendo (el servidor fallaría).
  const sinConexion = estadoDe(selectedLoteadora) === "apagada";
  const canSend = compuestos.length > 0 && faltan.length === 0 && !!selectedLoteadora && !sending && !imprimiendo && !sinConexion;
  const diasReadonly = !modoManual && jdeOnline && diasDesdeJde !== null;
  const canCargarMensaje = !!selectedLoteadora && !!plantilla && !cargandoMensaje && !imprimiendo && !sinConexion;
  const loteadoraItems = loteadoras.map((l) => ({ value: String(l.id), label: l.zona ? `${l.name} · ${l.zona}` : l.name }));

  // Solo los artículos de las familias de la loteadora elegida (sin familias = todos)
  const familiasLoteadora = (loteadoraSeleccionada?.familias ?? "").split(",").filter(Boolean);
  const articuloIds = articulos
    .filter((a) => familiasLoteadora.length === 0 || familiasLoteadora.includes(a.familia))
    .map((a) => a.id);
  const articuloLabel = (id: string) => {
    const a = articulos.find((x) => x.id === id);
    return a ? `${a.id} — ${a.descripcion}` : id;
  };
  const articuloPlaceholder = !selectedLoteadora ? "Elige primero la loteadora" : loadingArticulos ? "Cargando…" : articuloIds.length === 0 ? "Sin artículos disponibles para esta loteadora" : "Buscar por código o descripción…";

  return (
    <div data-nova-theme={effectiveTheme} ref={portalContainerRef} className="min-h-screen bg-sidebar text-foreground">
      <NovaPortalProvider container={portalContainerRef}>
        <div className="overflow-hidden bg-background md:m-2 md:rounded-xl md:shadow-sm md:outline md:outline-border">
          <Header user={sessionUser} onLogout={logout} mode={mode} onModeChange={setMode} />

          <main className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
                <CardTitle>Loteadora</CardTitle>
                <Badge className={jdeOnline ? "bg-emerald-400/10 text-emerald-600" : "bg-rose-400/10 text-rose-500"}>
                  {jdeOnline ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                  {jdeOnline ? "JDE conectado" : "JDE caído"}
                </Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-6 pt-4 lg:grid-cols-[1fr_1.2fr] lg:divide-x lg:divide-border">
                {/* ── Columna izquierda: formulario (compacto) ── */}
                <div className="space-y-3 lg:pr-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Datos del artículo</p>

                  {/* Primero la loteadora: el artículo carga su plantilla en ella */}
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">Loteadora</label>
                      {selectedLoteadora && (
                        <Button type="button" variant="ghost" size="icon-xs" onClick={fetchEstadoLoteadoras} disabled={loadingEstado} title="Refrescar el estado de la máquina">
                          <RefreshCw className={loadingEstado ? "size-3.5 animate-spin" : "size-3.5"} />
                        </Button>
                      )}
                    </div>
                    <Select items={loteadoraItems} value={selectedLoteadora || null} onValueChange={(v) => handleLoteadoraSelect(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={loteadoras.length === 0 ? "Sin loteadoras configuradas" : "Seleccionar loteadora…"} />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        {loteadoras.map((l) => (
                          <SelectItem
                            key={l.id}
                            value={String(l.id)}
                            disabled={estadoDe(String(l.id)) === "apagada"}
                            title={estadoLoteadoras.find((e) => e.id === l.id)?.motivo}
                          >
                            {l.name}{l.zona && <span className="text-muted-foreground"> · {l.zona}</span>}
                            {estadoDe(String(l.id)) === "apagada" && <span className="text-muted-foreground"> · Sin conexión</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {imprimiendo && (
                    <Alert className="border-amber-500/20 bg-amber-400/10 py-2">
                      <AlertTriangle className="text-amber-600" />
                      <AlertDescription className="flex flex-wrap items-center gap-x-2 text-xs text-amber-700 dark:text-amber-400">
                        La loteadora está imprimiendo: para la impresión en la máquina para cambiar de artículo o enviar datos.
                        <button type="button" onClick={fetchEstadoLoteadoras} className="underline hover:opacity-80">Comprobar de nuevo</button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {sinConexion && (
                    <Alert className="border-rose-500/20 bg-rose-400/10 py-2">
                      <PowerOff className="text-rose-500" />
                      <AlertDescription className="flex flex-wrap items-center gap-x-2 text-xs text-rose-600">
                        {estadoLoteadoras.find((e) => String(e.id) === selectedLoteadora)?.motivo ?? "La loteadora no responde"}. Comprueba que está encendida y con el cable de red.
                        <button type="button" onClick={fetchEstadoLoteadoras} className="underline hover:opacity-80">Comprobar de nuevo</button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {selectedLoteadora && !lineaLoteadora && necesita("linea") && (
                    <Alert className="border-amber-500/20 bg-amber-400/10 py-2">
                      <AlertTriangle className="text-amber-600" />
                      <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                        Esta loteadora no tiene línea de fabricación configurada — configúrala en /admin antes de poder enviar.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Solo con permiso (admin o 'loteadora.limpiar-buffer'): descarta envíos pendientes */}
                  {selectedLoteadora && tienePermiso(sessionUser, "loteadora.limpiar-buffer") && (
                    <div className="grid gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleLimpiarBuffer}
                        disabled={limpiandoBuffer}
                        className="w-fit whitespace-nowrap"
                        title="Vacía la cola de campos remotos pendientes (equivale a pulsar Clear en Ajustes de comunicación > Buffer en la máquina). No imprime nada."
                      >
                        {limpiandoBuffer ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
                        Limpiar buffer
                      </Button>
                    </div>
                  )}


                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Artículo
                      {loadingArticulos && <Loader2 className="ml-1.5 inline size-3 animate-spin text-muted-foreground" />}
                    </label>
                    <Combobox
                      items={articuloIds}
                      value={selectedArticulo?.id ?? null}
                      onValueChange={(v) => handleArticuloChange(v as string | null)}
                      itemToStringLabel={articuloLabel}
                    >
                      <ComboboxInput placeholder={articuloPlaceholder} disabled={!selectedLoteadora || !jdeOnline || loadingArticulos || imprimiendo || sinConexion} showClear />
                      <ComboboxContent>
                        <ComboboxEmpty>Sin resultados</ComboboxEmpty>
                        <ComboboxList>
                          {(id: string) => (
                            <ComboboxItem key={id} value={id}>{articuloLabel(id)}</ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  </div>

                  {selectedArticulo && !selectedArticulo.plantilla && (
                    <Alert className="border-amber-500/20 bg-amber-400/10 py-2">
                      <AlertTriangle className="text-amber-600" />
                      <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                        Este artículo no tiene una plantilla asociada — configúralo en /admin antes de poder enviar.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Lote Fresco y Juliano Cocida lado a lado — ambas de introducción
                      manual: el operario escribe el contenido exacto del lote (tal cual se
                      envía) y solo el día juliano de la cocida (el año se infiere, ver
                      resolveCocidaYear). La caducidad se calcula desde cocida, no desde
                      fabricación. */}
                  <div className="grid grid-cols-2 gap-3">
                    {necesita("fresco") && (
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-foreground">Lote Fresco</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={loteManual}
                        onChange={(e) => setLoteManual(e.target.value)}
                        placeholder="Ej: 263221"
                        maxLength={6}
                      />
                    </div>
                    )}
                    {(necesita("cocida") || necesita("caducidad")) && (
                    <div className="grid gap-1.5">
                      {/* El aviso va en línea con la etiqueta (no debajo del input) para que
                          no cambie de alto al aparecer/desaparecer y desplace el resto del
                          formulario — mismo patrón que los badges de "Días de caducidad". */}
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-foreground">Juliano Cocida</label>
                        {cocidaAnioAnterior && (
                          <Badge variant="outline" className="gap-1 text-amber-600">
                            <CalendarIcon className="size-3" />
                            Año anterior ({cocida})
                          </Badge>
                        )}
                      </div>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={cocidaJulianDay}
                        onChange={(e) => setCocidaJulianDay(e.target.value)}
                        placeholder="Día juliano (1-366)"
                        maxLength={3}
                      />
                    </div>
                    )}
                  </div>

                  {necesita("caducidad") && (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">Días de caducidad</label>
                      {diasDesdeJde !== null && !modoManual && (
                        <Badge variant="outline" className="text-sky-600">desde JDE</Badge>
                      )}
                      {(!jdeOnline || modoManual) && (
                        <Badge className="gap-1 bg-amber-400/10 text-amber-600">
                          <AlertTriangle className="size-3" />manual
                        </Badge>
                      )}
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={9999}
                      value={diasCad}
                      onChange={(e) => setDiasCad(e.target.value)}
                      placeholder="Nº de días"
                      readOnly={diasReadonly}
                      className={diasReadonly ? "bg-muted text-muted-foreground" : ""}
                    />
                    {jdeOnline && diasDesdeJde !== null && !modoManual && (
                      <button type="button" onClick={() => setModoManual(true)} className="w-fit text-left text-xs text-muted-foreground underline hover:text-foreground">
                        Introducir manualmente
                      </button>
                    )}
                    {modoManual && diasDesdeJde !== null && (
                      <button
                        type="button"
                        onClick={() => { setModoManual(false); setDiasCad(String(diasDesdeJde)); }}
                        className="w-fit text-left text-xs text-muted-foreground underline hover:text-foreground"
                      >
                        Usar valor de JDE ({diasDesdeJde} días)
                      </button>
                    )}
                  </div>
                  )}

                  {necesita("turno") && (
                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Turno</label>
                    <Select value={turno || null} onValueChange={(v) => setTurno(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar turno…" />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  )}

                  {/* Datos a introducir de la plantilla (p. ej. nº de certificado Kosher) */}
                  {plantilla && piezasManuales(plantilla.campos).map((m) => (
                    <div key={m.nombre} className="grid gap-1.5">
                      <label className="text-xs font-semibold text-foreground">{m.nombre}</label>
                      <Input
                        value={currentForm.manuales[m.nombre] ?? ""}
                        onChange={(e) => updateForm({ manuales: { ...currentForm.manuales, [m.nombre]: e.target.value } })}
                        maxLength={MAX_MANUAL}
                        placeholder={m.porDefecto || m.nombre}
                        className="font-mono"
                      />
                    </div>
                  ))}

                  {/* La plantilla la decide el artículo (no se puede elegir otra a mano);
                      el botón solo vuelve a cargar esa, p. ej. si estaba imprimiendo. */}
                  {selectedLoteadora && plantilla && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                      <div className="min-w-0">
                        <span className="block text-xs font-semibold text-foreground">
                          Plantilla
                        </span>
                        <span className="block truncate font-mono text-sm text-muted-foreground">{plantilla.messageName}</span>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleCargarMensaje} disabled={!canCargarMensaje} className="whitespace-nowrap">
                        {cargandoMensaje ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                        Volver a cargar
                      </Button>
                    </div>
                  )}
                </div>

                {/* ── Columna derecha: la etiqueta es el centro visual ── */}
                <div className="flex flex-col gap-4 lg:pl-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vista previa de impresión</p>
                  {avisoTurno && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
                      <AlertTriangle className="size-3.5" />{avisoTurno}
                    </p>
                  )}

                  {/* Etiqueta: grid de 2 columnas (en vez de la lista apilada original a
                      text-4xl) — más compacta que la versión original pero con más
                      presencia que un grid de 3 columnas, para no dejar un hueco enorme
                      antes del botón "Enviar" (ver §5/§14 docs/loteadora.md). Contorno
                      sólido, tanto en la tarjeta como en las casillas interiores. */}
                  <div className="rounded-xl border border-border bg-muted/30 p-6 shadow-sm">
                    <div className="text-center">
                      {selectedArticulo ? (
                        <>
                          <p className="font-mono text-xs text-muted-foreground">{selectedArticulo.id}</p>
                          <p className="text-sm font-semibold text-foreground">{selectedArticulo.descripcion}</p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Ningún artículo seleccionado</p>
                      )}
                    </div>
                    {plantilla ? (
                      <>
                        <p className="mt-3 text-center font-mono text-[11px] text-muted-foreground">{plantilla.messageName}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {compuestos.map((c, i) => {
                            const campo = plantilla.campos[i];
                            return (
                              <div key={c.fieldId} className="rounded-lg border border-border bg-background px-3 py-3 text-center">
                                <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Campo {c.fieldId}
                                </span>
                                <span className={`block break-all font-mono text-xl font-bold ${c.texto ? "text-foreground" : "text-muted-foreground/30"}`}>
                                  {c.texto || "—"}
                                </span>
                                <span className={`mt-1 block text-[10px] ${c.faltan.length ? "text-amber-600" : "text-muted-foreground"}`}>
                                  {c.faltan.length
                                    ? `Falta: ${c.faltan.map((t) => INFO_PIEZA[t].label).join(", ")}`
                                    : campo.piezas.map((p) => (p.tipo === "fijo" ? p.nombre : INFO_PIEZA[p.tipo].label)).join(" · ")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="mt-6 text-center text-sm text-muted-foreground">
                        {selectedArticulo ? "Este artículo no tiene plantilla: asígnale una en /admin para ver la etiqueta." : "Elige un artículo para ver cómo saldrá la etiqueta."}
                      </p>
                    )}
                  </div>

                  <div className="flex-1" />

                  {sendError && (
                    <Alert variant="destructive">
                      <XCircle />
                      <AlertDescription>
                        <span className="font-medium">{sendError}</span>
                        {sendErrorDetail && (
                          <div className="mt-1">
                            <button type="button" onClick={() => setShowSendErrorDetail((v) => !v)} className="text-xs underline hover:opacity-80">
                              {showSendErrorDetail ? "Ocultar detalle" : "Ver más"}
                            </button>
                            {showSendErrorDetail && (
                              <p className="mt-1 font-mono text-xs">Código de estado de la máquina: {sendErrorDetail}</p>
                            )}
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button onClick={pedirConfirmacionEnvio} disabled={!canSend} className="h-11 w-full text-sm font-semibold">
                    {sending ? <><Loader2 className="size-4 animate-spin" />Enviando...</> : <><Send className="size-4" />Enviar a loteadora</>}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Estado de las loteadoras (en vivo, se refresca solo cada 60s) */}
            <Card>
              <CardHeader className="flex flex-wrap items-center gap-2 border-b pb-4">
                <Printer className="size-4 text-primary" />
                <CardTitle>Estado de las loteadoras</CardTitle>
                <Button type="button" variant="ghost" size="icon-xs" onClick={fetchEstadoLoteadoras} disabled={loadingEstado} title="Refrescar el estado de las máquinas">
                  <RefreshCw className={loadingEstado ? "size-3.5 animate-spin" : "size-3.5"} />
                </Button>
              </CardHeader>
              <CardContent className="pt-4">
                {estadoLoteadoras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay loteadoras habilitadas configuradas en /admin.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {estadoLoteadoras.map((l) => {
                      const info = ESTADO_INFO[l.state];
                      const Icon = info.icon;
                      return (
                        <div key={l.id} className="rounded-lg border border-border px-4 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {l.name}
                              {l.zona && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{l.zona}</span>}
                            </span>
                            <Badge className={`gap-1.5 whitespace-nowrap ${info.className}`}>
                              <Icon className="size-3.5" />
                              {info.label}
                            </Badge>
                          </div>
                          {l.motivo && <p className="mt-1 text-xs text-muted-foreground">{l.motivo}</p>}
                          {l.ultimoEnvio ? (
                            <div className="mt-2 border-t border-border pt-2">
                              <p className="text-[11px] text-muted-foreground">
                                Último envío · {cuandoEnvio(l.ultimoEnvio.enviadoAt)}
                                {l.ultimoEnvio.usuario && <> · {l.ultimoEnvio.usuario}</>}
                              </p>
                              <p className="truncate font-mono text-xs text-muted-foreground">{l.ultimoEnvio.plantilla}</p>
                              <div className="mt-1 grid gap-0.5 overflow-x-auto">
                                {l.ultimoEnvio.lineas.map((linea, i) => (
                                  <span key={i} className="font-mono text-sm font-semibold whitespace-pre text-foreground">
                                    {linea.map((t, j) => t.reloj
                                      ? <span key={j} className="font-normal text-muted-foreground" title="Reloj de la máquina (hora de cada impresión)">{t.texto}</span>
                                      : t.texto)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">Sin envíos desde el panel</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </main>
        </div>
        <Dialog open={!!confirmacion} onOpenChange={(o) => !o && cancelarConfirmacion()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmacion?.titulo}</DialogTitle>
              <DialogDescription render={<div />}>{confirmacion?.detalle}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={cancelarConfirmacion}>Cancelar</Button>
              <Button onClick={() => { confirmacion?.accion(); setConfirmacion(null); }}>{confirmacion?.boton}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Toaster />
      </NovaPortalProvider>
    </div>
  );
}

// El panel no se pinta hasta que el provider sabe si esta sesión puede entrar
// (antes se veía un instante antes de rebotar al login). `screen="loteadora"`
// aplica la misma regla que requireScreenAccess('loteadora') en servidor.
export default function LoteadoraPage() {
  return (
    <RequireAccess screen="loteadora">
      <LoteadoraPanel />
    </RequireAccess>
  );
}
