"use client";

// Panel operativo de la loteadora — rediseño sobre el sistema Nova (ShadcnSpace).
// Primer panel Nova puramente de formulario (sin tabla/KPI numérico) y primero en
// necesitar un desplegable con búsqueda por texto (Combobox) — ver
// components/nova/README.md para el detalle de ambos patrones nuevos.
// La lógica de negocio (cálculo de lote/cocida/caducidad, protocolo TIJ, plantillas
// por artículo) es la misma que la versión anterior — ver docs/loteadora.md.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { type ThemeMode } from "@/components/nova/mode-toggle";
import { NovaPortalProvider } from "@/components/nova/portal-container";
import DatePicker from "@/components/nova/date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Input } from "@/components/nova/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/nova/ui/combobox";
import { Toaster } from "@/components/nova/ui/sonner";

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface PlantillaArticulo { messageName: string; lotFieldId: number; cocidaFieldId: number; expiryFieldId: number }
interface Articulo { id: string; descripcion: string; diasCaducidad: number; plantilla: PlantillaArticulo | null }
interface Loteadora { id: number; name: string }
type EstadoLoteadoraValor = "activa" | "en_error" | "standby" | "apagada";
interface EstadoLoteadora { id: number; name: string; state: EstadoLoteadoraValor }

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

export default function LoteadoraPage() {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

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
  const [selectedArticulo, setSelectedArticulo] = useState<Articulo | null>(null);
  const [loadingArticulos, setLoadingArticulos] = useState(false);

  // Formulario
  const [fechaFab, setFechaFab] = useState(todayISO());
  const [fechaCocida, setFechaCocida] = useState(todayISO());
  const [diasCad, setDiasCad] = useState("");
  const [diasDesdeJde, setDiasDesdeJde] = useState<number | null>(null);
  const [modoManual, setModoManual] = useState(false);

  // Estado JDE
  const [jdeOnline, setJdeOnline] = useState(true);

  // Loteadora de destino
  const [loteadoras, setLoteadoras] = useState<Loteadora[]>([]);
  const [selectedLoteadora, setSelectedLoteadora] = useState("");
  const [estadoLoteadoras, setEstadoLoteadoras] = useState<EstadoLoteadora[]>([]);
  const [loadingEstado, setLoadingEstado] = useState(false);
  const [limpiandoBuffer, setLimpiandoBuffer] = useState(false);

  // Plantilla (mensaje) a cargar en la loteadora seleccionada
  const [mensajes, setMensajes] = useState<string[]>([]);
  const [selectedMensaje, setSelectedMensaje] = useState("");
  const [loadingMensajes, setLoadingMensajes] = useState(false);
  const [cargandoMensaje, setCargandoMensaje] = useState(false);

  // Envío
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null);
  const [showSendErrorDetail, setShowSendErrorDetail] = useState(false);

  useEffect(() => { checkSession(); }, []);

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
      setSelectedMensaje("");
      return;
    }
    // Se refresca el estado en vivo justo aquí (no solo cada 60s) para que el
    // aviso de "está imprimiendo" no vaya desacompasado del check real que
    // hace fetchMensajes en este mismo instante (protocolo §3.5.15 vs §3.5.20).
    fetchEstadoLoteadoras();
    fetchMensajes(selectedLoteadora);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoteadora]);

  // Autocarga de plantilla: si el artículo elegido tiene una plantilla
  // asociada (configurada en /admin), se carga sola en la loteadora sin
  // pedir confirmación — sustituye a la selección manual para ese caso.
  useEffect(() => {
    if (!selectedLoteadora || !selectedArticulo?.plantilla) return;
    cargarMensaje(selectedArticulo.plantilla.messageName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedArticulo, selectedLoteadora]);

  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) setSessionUser(await res.json());
      else router.push("/login");
    } catch {
      router.push("/login");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

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
      const res = await fetch(`/api/loteadora/mensajes?loteadoraId=${loteadoraId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al listar las plantillas de la loteadora");
      setMensajes(data.messages);
      setSelectedMensaje("");
    } catch (err: any) {
      setMensajes([]);
      setSelectedMensaje("");
      toast.error(err.message || "Error al listar las plantillas de la loteadora");
    } finally {
      setLoadingMensajes(false);
    }
  };

  const cargarMensaje = async (messageName: string) => {
    if (!selectedLoteadora || !messageName || cargandoMensaje) return;
    setSelectedMensaje(messageName);
    setCargandoMensaje(true);
    try {
      const res = await fetch("/api/loteadora/cargar-mensaje", {
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
      const res = await fetch("/api/loteadora/limpiar-buffer", {
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
    setSelectedArticulo(art);
    if (!art) return;
    if (art.diasCaducidad > 0) {
      setDiasDesdeJde(art.diasCaducidad);
      setDiasCad(String(art.diasCaducidad));
      setModoManual(false);
    } else {
      setDiasDesdeJde(null);
      setDiasCad("");
      setModoManual(true);
    }
  };

  const handleEnviar = async () => {
    if (!canSend || !fechaCaducidad) return;
    setSending(true);
    setSendError(null);
    setSendErrorDetail(null);
    setShowSendErrorDetail(false);
    try {
      const res = await fetch("/api/loteadora/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loteadoraId: Number(selectedLoteadora),
          articuloId: selectedArticulo?.id,
          lote,
          fechaCocida: cocida,
          fechaCaducidad: formatDateES(fechaCaducidad),
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
  const canSend = !!lote && !!cocida && !!fechaCaducidad && !!selectedArticulo?.plantilla && !!selectedLoteadora && !sending;
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

          <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
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
                    <p className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5 flex-shrink-0" />
                      Este artículo no tiene una plantilla asociada — configúralo en /admin antes de poder enviar.
                    </p>
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
                    <label className="text-xs font-semibold text-foreground">Loteadora</label>
                    <Select value={selectedLoteadora || undefined} onValueChange={(v) => setSelectedLoteadora(v as string)}>
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

                  {/* Aspecto de etiqueta/cupón: el "perforado" queda solo en los separadores internos
                      (línea discontinua alrededor de toda la tarjeta se lee como "zona vacía/placeholder"
                      en la mayoría de sistemas de diseño — justo lo contrario de "esto es lo importante") */}
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
                    <div className="mt-4 divide-y divide-dashed divide-border">
                      {[
                        { label: "Lote", value: lote },
                        { label: "Cocida", value: cocida },
                        { label: "F. Caducidad", value: fechaCaducidad ? formatDateES(fechaCaducidad) : null },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex flex-col items-center gap-0.5 py-3 first:pt-0 last:pb-0">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
                          <span className={`font-mono text-4xl font-bold tracking-widest ${value ? "text-foreground" : "text-muted-foreground/25"}`}>
                            {value ?? "——"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {fabDate && (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Badge variant="secondary">Lote — Año: {String(fabDate.getFullYear()).slice(-2)} · Día juliano: {toJulianDay(fabDate)}</Badge>
                      {cocidaDate && (
                        <Badge variant="secondary">Cocida — Año: {String(cocidaDate.getFullYear()).slice(-2)} · Día juliano: {toJulianDay(cocidaDate)}</Badge>
                      )}
                      {cocidaDate && fechaCaducidad && (
                        <Badge variant="secondary">{formatDateES(cocidaDate)} + {diasNum} días</Badge>
                      )}
                    </div>
                  )}

                  <div className="flex-1" />

                  {sendError && (
                    <div className="space-y-1 rounded-lg border border-rose-500/20 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-600 dark:text-rose-400">
                      <div className="flex items-center gap-2">
                        <XCircle className="size-4 flex-shrink-0" />
                        {sendError}
                      </div>
                      {sendErrorDetail && (
                        <div className="pl-6">
                          <button type="button" onClick={() => setShowSendErrorDetail((v) => !v)} className="text-xs font-normal underline hover:opacity-80">
                            {showSendErrorDetail ? "Ocultar detalle" : "Ver más"}
                          </button>
                          {showSendErrorDetail && (
                            <p className="mt-1 font-mono text-xs font-normal">Código de estado de la máquina: {sendErrorDetail}</p>
                          )}
                        </div>
                      )}
                    </div>
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
