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
} from "lucide-react";
import Header from "@/components/shadcn-space/blocks/topbar-02/header";
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider";
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import DatePicker from "@/components/nova/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Alert, AlertDescription } from "@/components/nova/ui/alert";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Input } from "@/components/nova/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/nova/ui/combobox";
import { Toaster } from "@/components/nova/ui/sonner";

interface PlantillaArticulo { messageName: string; lotFieldId: number; cocidaFieldId: number; expiryFieldId: number; horaFieldId: number; turnoFieldId: number; lineaFieldId: number }
interface Articulo { id: string; descripcion: string; diasCaducidad: number; plantilla: PlantillaArticulo | null }
interface Loteadora { id: number; name: string; linea: string }
type EstadoLoteadoraValor = "activa" | "en_error" | "standby" | "apagada";
interface EstadoLoteadora { id: number; name: string; state: EstadoLoteadoraValor }

// Formulario de UN trabajo de impresión (artículo/fechas/turno/plantilla elegida).
// Se guarda uno por loteadora (ver `formStates` en el componente) para que cambiar
// de loteadora no mezcle ni pierda lo que había en cada una.
interface LoteadoraFormState {
  selectedArticuloId: string | null;
  fechaFab: string;
  fechaCocida: string;
  diasCad: string;
  diasDesdeJde: number | null;
  modoManual: boolean;
  turno: string;
  selectedMensaje: string;
}

// Colores fijos (enum cerrado de 4 estados) — mismo formato "bg-x/10 text-x" que el
// resto de indicadores de estado en Nova (ver components/nova/mrp-materials-table.tsx).
const ESTADO_INFO: Record<EstadoLoteadoraValor, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  activa: { label: "Activa", className: "bg-emerald-400/10 text-emerald-600", icon: CheckCircle2 },
  en_error: { label: "En error", className: "bg-rose-400/10 text-rose-500", icon: XCircle },
  standby: { label: "Conectada (sin imprimir)", className: "bg-amber-400/10 text-amber-600", icon: AlertTriangle },
  apagada: { label: "Sin conexión", className: "bg-muted text-muted-foreground", icon: PowerOff },
};

// --- Utilidades de cálculo (sin cambios respecto a la versión anterior) ---
function toJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86400000);
}
function toLote(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const jd = String(toJulianDay(date)).padStart(3, "0");
  return yy + jd;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function formatDateES(date: Date): string {
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function toHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseFecha(val: string): Date | null {
  if (!val) return null;
  const [y, m, d] = val.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function defaultFormState(): LoteadoraFormState {
  return {
    selectedArticuloId: null,
    fechaFab: todayISO(),
    fechaCocida: todayISO(),
    diasCad: "",
    diasDesdeJde: null,
    modoManual: false,
    turno: "",
    selectedMensaje: "",
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

  // Plantilla (mensaje) a cargar en la loteadora seleccionada — la lista de
  // nombres disponibles en la máquina (mensajes) es dato en vivo, se refresca
  // siempre; cuál está elegida (selectedMensaje) vive en formStates.
  const [mensajes, setMensajes] = useState<string[]>([]);
  const [loadingMensajes, setLoadingMensajes] = useState(false);
  const [cargandoMensaje, setCargandoMensaje] = useState(false);

  // Formulario activo: el de la loteadora seleccionada ahora mismo (o el
  // "borrador" sin loteadora todavía, clave "").
  const currentForm = formStates[selectedLoteadora] ?? defaultFormState();
  const { fechaFab, fechaCocida, diasCad, diasDesdeJde, modoManual, turno, selectedMensaje } = currentForm;
  const selectedArticulo = articulos.find((a) => a.id === currentForm.selectedArticuloId) ?? null;
  const updateForm = (patch: Partial<LoteadoraFormState>) => {
    setFormStates((prev) => ({
      ...prev,
      [selectedLoteadora]: { ...(prev[selectedLoteadora] ?? defaultFormState()), ...patch },
    }));
  };
  const setFechaFab = (v: string) => updateForm({ fechaFab: v });
  const setFechaCocida = (v: string) => updateForm({ fechaCocida: v });
  const setDiasCad = (v: string) => updateForm({ diasCad: v });
  const setModoManual = (v: boolean) => updateForm({ modoManual: v });
  const setTurno = (v: string) => updateForm({ turno: v });
  const setSelectedMensaje = (v: string) => updateForm({ selectedMensaje: v });

  // Hora de envío (HHmm): reloj en vivo, no editable — se manda tal cual esté
  // en el instante exacto de pulsar "Enviar".
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

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
    if (!selectedLoteadora) {
      setMensajes([]);
      return;
    }
    // Se refresca el estado en vivo justo aquí (no solo cada 60s) para que el
    // aviso de "está imprimiendo" no vaya desacompasado del check real que
    // hace fetchMensajes en este mismo instante (protocolo §3.5.15 vs §3.5.20).
    fetchEstadoLoteadoras();
    fetchMensajes(selectedLoteadora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoteadora]);

  // Autocarga de plantilla: si el artículo elegido (para ESTA loteadora, ver
  // formStates) tiene una plantilla asociada, se carga sola sin pedir
  // confirmación. Dependencias por valor (id/messageName), no por el objeto
  // `selectedArticulo` entero — ese objeto cambia de referencia cada vez que
  // se refresca `articulos` (cada 60s) aunque el contenido sea el mismo, y
  // dispararía una recarga innecesaria en la loteadora cada minuto.
  useEffect(() => {
    if (!selectedLoteadora || !selectedArticulo?.plantilla) return;
    cargarMensaje(selectedArticulo.plantilla.messageName);
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

  const fetchMensajes = async (loteadoraId: string) => {
    setLoadingMensajes(true);
    try {
      const res = await apiFetch(`/api/loteadora/mensajes?loteadoraId=${loteadoraId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al listar las plantillas de la loteadora");
      setMensajes(data.messages);
    } catch (err: any) {
      setMensajes([]);
      toast.error(err.message || "Error al listar las plantillas de la loteadora");
    } finally {
      setLoadingMensajes(false);
    }
  };

  const cargarMensaje = async (messageName: string) => {
    if (!selectedLoteadora || !messageName || cargandoMensaje) return;
    updateForm({ selectedMensaje: messageName });
    setCargandoMensaje(true);
    try {
      const res = await apiFetch("/api/loteadora/cargar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loteadoraId: Number(selectedLoteadora), messageName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar la plantilla");
      toast.success("Plantilla cargada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al cargar la plantilla");
    } finally {
      setCargandoMensaje(false);
    }
  };

  const handleCargarMensaje = () => cargarMensaje(selectedMensaje);

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
    if (!art) {
      updateForm({ selectedArticuloId: null });
      return;
    }
    updateForm({
      selectedArticuloId: art.id,
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

  const handleEnviar = async () => {
    if (!canSend || !fechaCaducidad) return;
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
          lote,
          fechaCocida: cocida,
          fechaCaducidad: formatDateES(fechaCaducidad),
          horaEnvio: toHHmm(new Date()),
          turno,
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
    } catch (err: any) {
      setSendError(err.message || "Error al enviar a la loteadora");
    } finally {
      setSending(false);
    }
  };

  // Cálculos derivados
  const fabDate = parseFecha(fechaFab);
  const cocidaDate = parseFecha(fechaCocida);
  const diasNum = parseInt(diasCad, 10);
  const lote = fabDate ? toLote(fabDate) : null;
  const cocida = cocidaDate ? toLote(cocidaDate) : null;
  const fechaCaducidad = cocidaDate && !isNaN(diasNum) && diasNum > 0 ? addDays(cocidaDate, diasNum) : null;
  const loteadoraSeleccionada = loteadoras.find((l) => String(l.id) === selectedLoteadora) ?? null;
  const lineaLoteadora = loteadoraSeleccionada?.linea || null;
  const canSend = !!lote && !!cocida && !!fechaCaducidad && !!turno && !!lineaLoteadora && !!selectedArticulo?.plantilla && !!selectedLoteadora && !sending;
  const diasReadonly = !modoManual && jdeOnline && diasDesdeJde !== null;
  const canCargarMensaje = !!selectedLoteadora && !!selectedMensaje && !cargandoMensaje;

  const articuloIds = articulos.map((a) => a.id);
  const articuloLabel = (id: string) => {
    const a = articulos.find((x) => x.id === id);
    return a ? `${a.id} — ${a.descripcion}` : id;
  };
  const articuloPlaceholder = loadingArticulos ? "Cargando…" : articulos.length === 0 ? "Sin artículos disponibles" : "Buscar por código o descripción…";

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
                      <ComboboxInput placeholder={articuloPlaceholder} disabled={!jdeOnline || loadingArticulos} showClear />
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

                  {/* Fabricación y cocida lado a lado — la caducidad se calcula desde cocida, no desde fabricación */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-foreground">Fabricación</label>
                      <div className="flex gap-1.5">
                        <div className="min-w-0 flex-1"><DatePicker value={fechaFab} onChange={setFechaFab} /></div>
                        <Button type="button" variant="outline" size="icon-sm" onClick={() => setFechaFab(todayISO())} title="Hoy">
                          <CalendarIcon className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-foreground">Cocida</label>
                      <div className="flex gap-1.5">
                        <div className="min-w-0 flex-1"><DatePicker value={fechaCocida} onChange={setFechaCocida} /></div>
                        <Button type="button" variant="outline" size="icon-sm" onClick={() => setFechaCocida(todayISO())} title="Hoy">
                          <CalendarIcon className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>

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

                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Turno</label>
                    <Select value={turno || undefined} onValueChange={(v) => setTurno(v as string)}>
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

                  <div className="grid gap-1.5">
                    <label className="text-xs font-semibold text-foreground">Loteadora</label>
                    <Select value={selectedLoteadora || undefined} onValueChange={(v) => handleLoteadoraSelect(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={loteadoras.length === 0 ? "Sin loteadoras configuradas" : "Seleccionar loteadora…"} />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        {loteadoras.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedLoteadora && !lineaLoteadora && (
                    <Alert className="border-amber-500/20 bg-amber-400/10 py-2">
                      <AlertTriangle className="text-amber-600" />
                      <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
                        Esta loteadora no tiene línea de fabricación configurada — configúrala en /admin antes de poder enviar.
                      </AlertDescription>
                    </Alert>
                  )}

                  {selectedLoteadora && (
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

                  {selectedLoteadora && (
                    <div className="grid gap-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        Plantilla
                        {loadingMensajes && <Loader2 className="ml-1.5 inline size-3 animate-spin text-muted-foreground" />}
                      </label>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Select value={selectedMensaje || undefined} onValueChange={(v) => setSelectedMensaje(v as string)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={mensajes.length === 0 ? "Sin plantillas disponibles" : "Seleccionar plantilla…"} />
                            </SelectTrigger>
                            <SelectContent align="start" alignItemWithTrigger={false}>
                              {mensajes.map((m) => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={handleCargarMensaje} disabled={!canCargarMensaje} className="whitespace-nowrap">
                          {cargandoMensaje ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                          Cargar plantilla
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Columna derecha: la etiqueta es el centro visual ── */}
                <div className="flex flex-col gap-4 lg:pl-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vista previa de impresión</p>

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
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      {[
                        { label: "Lote", value: lote },
                        { label: "Cocida", value: cocida },
                        { label: "Caducidad", value: fechaCaducidad ? formatDateES(fechaCaducidad) : null },
                        { label: "Hora", value: toHHmm(ahora) },
                        { label: "Turno", value: turno || null },
                        { label: "Línea", value: lineaLoteadora },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg border border-border bg-background px-3 py-3 text-center">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                          <span className={`block truncate font-mono text-xl font-bold ${value ? "text-foreground" : "text-muted-foreground/30"}`}>
                            {value ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
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

                  <Button onClick={handleEnviar} disabled={!canSend} className="h-11 w-full text-sm font-semibold">
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
                {loadingEstado && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
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
                        <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-2.5">
                          <span className="truncate text-sm font-medium text-foreground">{l.name}</span>
                          <Badge className={`gap-1.5 whitespace-nowrap ${info.className}`}>
                            <Icon className="size-3.5" />
                            {info.label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </main>
        </div>
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
