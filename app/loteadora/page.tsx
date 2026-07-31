"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tag, CheckCircle2, XCircle, Loader2, Send, AlertTriangle, Calendar, Printer, PowerOff, Upload, Eraser } from "lucide-react"
import Navbar from "@/components/Navbar"
import { SingleSelect } from "@/components/SingleSelect"
import { useRouter } from "next/navigation"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }
interface Articulo { id: string; descripcion: string; diasCaducidad: number }
interface Loteadora { id: number; name: string }
type EstadoLoteadoraValor = 'activa' | 'en_error' | 'standby' | 'apagada'
interface EstadoLoteadora { id: number; name: string; state: EstadoLoteadoraValor }

const ESTADO_INFO: Record<EstadoLoteadoraValor, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  activa: { label: 'Activa', className: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2 },
  en_error: { label: 'En error', className: 'bg-red-50 text-red-700 border-red-200', icon: XCircle },
  standby: { label: 'Conectada (sin imprimir)', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  apagada: { label: 'Sin conexión', className: 'bg-gray-100 text-gray-500 border-gray-200', icon: PowerOff },
}

// --- Utilidades de cálculo ---
function toJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86400000)
}

function toLote(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2)
  const jd = String(toJulianDay(date)).padStart(3, '0')
  return yy + jd
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatDateES(date: Date): string {
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseFecha(val: string): Date | null {
  if (!val) return null
  const [y, m, d] = val.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export default function LoteadoraPage() {
  const router = useRouter()
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)

  // Selección de artículo (búsqueda directa, sin marca)
  const [articulos, setArticulos] = useState<Articulo[]>([])
  const [selectedArticulo, setSelectedArticulo] = useState<Articulo | null>(null)
  const [loadingArticulos, setLoadingArticulos] = useState(false)

  // Formulario
  const [fechaFab, setFechaFab] = useState(todayISO())
  const [diasCad, setDiasCad] = useState('')
  const [diasDesdeJde, setDiasDesdeJde] = useState<number | null>(null)
  const [modoManual, setModoManual] = useState(false)

  // Estado JDE
  const [jdeOnline, setJdeOnline] = useState(true)

  // Loteadora de destino
  const [loteadoras, setLoteadoras] = useState<Loteadora[]>([])
  const [selectedLoteadora, setSelectedLoteadora] = useState('')
  const [estadoLoteadoras, setEstadoLoteadoras] = useState<EstadoLoteadora[]>([])
  const [loadingEstado, setLoadingEstado] = useState(false)
  const [limpiandoBuffer, setLimpiandoBuffer] = useState(false)
  const [bufferMensaje, setBufferMensaje] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null)

  // Plantilla (mensaje) a cargar en la loteadora seleccionada
  const [mensajes, setMensajes] = useState<string[]>([])
  const [selectedMensaje, setSelectedMensaje] = useState('')
  const [loadingMensajes, setLoadingMensajes] = useState(false)
  const [cargandoMensaje, setCargandoMensaje] = useState(false)
  const [mensajeError, setMensajeError] = useState<string | null>(null)
  const [mensajeSuccess, setMensajeSuccess] = useState(false)

  // Envío
  const [sending, setSending] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [sendWarning, setSendWarning] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendErrorDetail, setSendErrorDetail] = useState<string | null>(null)
  const [showSendErrorDetail, setShowSendErrorDetail] = useState(false)

  useEffect(() => { checkSession() }, [])

  useEffect(() => {
    fetchArticulos()
    fetchLoteadoras()
    fetchEstadoLoteadoras()

    // Estado en vivo: JDE y loteadoras se refrescan solos cada 60s mientras
    // el panel esté abierto (cada comprobación de loteadora abre y cierra
    // una conexión TCP breve — protocolo TIJ, comando 14).
    const interval = setInterval(() => {
      fetchArticulos()
      fetchEstadoLoteadoras()
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setMensajeError(null)
    if (!selectedLoteadora) {
      setMensajes([])
      setSelectedMensaje('')
      return
    }
    // Se refresca el estado en vivo justo aquí (no solo cada 60s) para que el
    // aviso de "está imprimiendo" no vaya desacompasado del check real que
    // hace fetchMensajes en este mismo instante (protocolo §3.5.15 vs §3.5.20).
    fetchEstadoLoteadoras()
    fetchMensajes(selectedLoteadora)
  }, [selectedLoteadora])

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) setSessionUser(await res.json())
      else router.push('/login')
    } catch { router.push('/login') }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  // También sirve como comprobación de vida de JDE (badge "JDE conectado"),
  // por eso se repite cada 60s junto al resto del estado en vivo — no toca la
  // selección de artículo ya hecha, solo refresca la lista disponible.
  const fetchArticulos = async () => {
    setLoadingArticulos(true)
    try {
      const res = await fetch('/api/loteadora/articulos')
      if (!res.ok) throw new Error()
      setArticulos(await res.json())
      setJdeOnline(true)
    } catch {
      setJdeOnline(false)
      setArticulos([])
    } finally {
      setLoadingArticulos(false)
    }
  }

  const fetchLoteadoras = async () => {
    try {
      const res = await fetch('/api/loteadora/impresoras')
      if (!res.ok) throw new Error()
      setLoteadoras(await res.json())
    } catch {
      setLoteadoras([])
    }
  }

  const fetchEstadoLoteadoras = async () => {
    setLoadingEstado(true)
    try {
      const res = await fetch('/api/loteadora/estado')
      if (!res.ok) throw new Error()
      setEstadoLoteadoras(await res.json())
    } catch {
      setEstadoLoteadoras([])
    } finally {
      setLoadingEstado(false)
    }
  }

  const fetchMensajes = async (loteadoraId: string) => {
    setLoadingMensajes(true)
    try {
      const res = await fetch(`/api/loteadora/mensajes?loteadoraId=${loteadoraId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al listar las plantillas de la loteadora')
      setMensajes(data.messages)
      setSelectedMensaje('')
    } catch (err: any) {
      setMensajes([])
      setSelectedMensaje('')
      setMensajeError(err.message || 'Error al listar las plantillas de la loteadora')
    } finally {
      setLoadingMensajes(false)
    }
  }

  const handleCargarMensaje = async () => {
    if (!selectedLoteadora || !selectedMensaje || cargandoMensaje) return
    setCargandoMensaje(true)
    setMensajeError(null)
    try {
      const res = await fetch('/api/loteadora/cargar-mensaje', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loteadoraId: Number(selectedLoteadora), messageName: selectedMensaje }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar la plantilla')
      setMensajeSuccess(true)
      setTimeout(() => setMensajeSuccess(false), 3000)
    } catch (err: any) {
      setMensajeError(err.message || 'Error al cargar la plantilla')
    } finally {
      setCargandoMensaje(false)
    }
  }

  const handleLimpiarBuffer = async () => {
    if (!selectedLoteadora || limpiandoBuffer) return
    setLimpiandoBuffer(true)
    setBufferMensaje(null)
    try {
      const res = await fetch('/api/loteadora/limpiar-buffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loteadoraId: Number(selectedLoteadora) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al limpiar el buffer')
      setBufferMensaje({ tipo: 'success', texto: 'Buffer de campos remotos vaciado' })
    } catch (err: any) {
      setBufferMensaje({ tipo: 'error', texto: err.message || 'Error al limpiar el buffer' })
    } finally {
      setLimpiandoBuffer(false)
      setTimeout(() => setBufferMensaje(null), 5000)
    }
  }

  const handleArticuloChange = (id: string) => {
    const art = articulos.find(a => a.id === id) ?? null
    setSelectedArticulo(art)
    if (!art) return
    if (art.diasCaducidad > 0) {
      setDiasDesdeJde(art.diasCaducidad)
      setDiasCad(String(art.diasCaducidad))
      setModoManual(false)
    } else {
      setDiasDesdeJde(null)
      setDiasCad('')
      setModoManual(true)
    }
  }

  const limpiar = () => {
    setSelectedArticulo(null)
    setDiasDesdeJde(null)
    setDiasCad('')
    setModoManual(false)
  }

  const handleEnviar = async () => {
    if (!canSend || !fechaCaducidad) return
    setSending(true)
    setSendError(null)
    setSendErrorDetail(null)
    setShowSendErrorDetail(false)
    setSendWarning(null)
    try {
      const res = await fetch('/api/loteadora/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loteadoraId: Number(selectedLoteadora),
          lote,
          fechaCaducidad: formatDateES(fechaCaducidad),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSendError(data.error || 'Error al enviar a la loteadora')
        setSendErrorDetail(data.detail || null)
        return
      }
      setEnviado(true)
      setSendWarning(data.warning || null)
      setTimeout(() => { setEnviado(false); setSendWarning(null) }, data.warning ? 8000 : 3000)
    } catch (err: any) {
      setSendError(err.message || 'Error al enviar a la loteadora')
    } finally {
      setSending(false)
    }
  }

  // Cálculos derivados
  const fabDate = parseFecha(fechaFab)
  const diasNum = parseInt(diasCad, 10)
  const lote = fabDate ? toLote(fabDate) : null
  const fechaCaducidad = (fabDate && !isNaN(diasNum) && diasNum > 0) ? addDays(fabDate, diasNum) : null
  const canSend = !!lote && !!fechaCaducidad && !!selectedArticulo && !!selectedLoteadora && !sending
  const diasReadonly = !modoManual && jdeOnline && diasDesdeJde !== null
  const canCargarMensaje = !!selectedLoteadora && !!selectedMensaje && !cargandoMensaje

  return (
    <main className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-5xl space-y-8">

        <Navbar currentPanel="loteadora" user={sessionUser} onLogout={logout} />

        <div className="bg-white rounded-xl shadow-sm border border-gray-200" style={{ borderTop: '3px solid #D30B15' }}>

          {/* Cabecera */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h1 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <Tag className="h-4 w-4" style={{ color: '#D30B15' }} />
              Loteadora
            </h1>
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${jdeOnline ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
              {jdeOnline
                ? <><CheckCircle2 className="h-3.5 w-3.5" />JDE conectado</>
                : <><XCircle className="h-3.5 w-3.5" />JDE caído</>}
            </div>
          </div>

          {/* Cuerpo en 2 columnas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">

            {/* ── Columna izquierda: formulario ── */}
            <div className="p-6 space-y-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Datos del artículo</p>

              {/* Artículo */}
              <div className="grid gap-1.5">
                <label htmlFor="articulo" className="text-xs font-semibold text-gray-700">
                  Artículo
                  {loadingArticulos && <Loader2 className="inline h-3 w-3 animate-spin ml-1.5 text-gray-400" />}
                </label>
                <div className={(!jdeOnline || loadingArticulos) ? 'opacity-50 pointer-events-none' : ''}>
                  <SingleSelect
                    label="artículo"
                    showId
                    allLabel={
                      loadingArticulos
                        ? 'Cargando…'
                        : articulos.length === 0
                          ? 'Sin artículos disponibles'
                          : 'Buscar por código o descripción…'
                    }
                    value={selectedArticulo?.id || 'all'}
                    onChange={id => id === 'all' ? setSelectedArticulo(null) : handleArticuloChange(id)}
                    options={articulos.map(a => ({ id: a.id, description: a.descripcion }))}
                  />
                </div>
              </div>

              {selectedArticulo && (
                <button
                  type="button"
                  onClick={limpiar}
                  className="text-xs text-gray-400 hover:text-gray-600 underline w-fit"
                >
                  Limpiar selección
                </button>
              )}

              {/* Fecha de fabricación */}
              <div className="grid gap-1.5">
                <label htmlFor="fechaFab" className="text-xs font-semibold text-gray-700">Fecha de fabricación</label>
                <div className="flex gap-2">
                  <Input
                    id="fechaFab"
                    type="date"
                    value={fechaFab}
                    onChange={e => setFechaFab(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFechaFab(todayISO())}
                    className="text-xs text-gray-600 whitespace-nowrap"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Hoy
                  </Button>
                </div>
              </div>

              {/* Días de caducidad */}
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="diasCad" className="text-xs font-semibold text-gray-700">Días de caducidad</label>
                  {diasDesdeJde !== null && !modoManual && (
                    <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">desde JDE</span>
                  )}
                  {(!jdeOnline || modoManual) && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />manual
                    </span>
                  )}
                </div>
                <Input
                  id="diasCad"
                  type="number"
                  min={1}
                  max={9999}
                  value={diasCad}
                  onChange={e => setDiasCad(e.target.value)}
                  placeholder="Nº de días"
                  readOnly={diasReadonly}
                  className={diasReadonly ? 'bg-gray-50 text-gray-500 cursor-default' : ''}
                />
                {jdeOnline && diasDesdeJde !== null && !modoManual && (
                  <button type="button" onClick={() => setModoManual(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 text-left underline w-fit">
                    Introducir manualmente
                  </button>
                )}
                {modoManual && diasDesdeJde !== null && (
                  <button type="button" onClick={() => { setModoManual(false); setDiasCad(String(diasDesdeJde)) }}
                    className="text-xs text-gray-400 hover:text-gray-600 text-left underline w-fit">
                    Usar valor de JDE ({diasDesdeJde} días)
                  </button>
                )}
              </div>

              {/* Loteadora de destino */}
              <div className="grid gap-1.5">
                <label htmlFor="loteadora" className="text-xs font-semibold text-gray-700">Loteadora</label>
                <SingleSelect
                  label="loteadora"
                  allLabel={loteadoras.length === 0 ? 'Sin loteadoras configuradas' : 'Seleccionar loteadora…'}
                  value={selectedLoteadora || 'all'}
                  onChange={id => setSelectedLoteadora(id === 'all' ? '' : id)}
                  options={loteadoras.map(l => ({ id: String(l.id), description: l.name }))}
                />
              </div>

              {/* Limpiar buffer de campos remotos pendientes (comando 21) */}
              {selectedLoteadora && (
                <div className="grid gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLimpiarBuffer}
                    disabled={limpiandoBuffer}
                    className="text-xs text-gray-600 whitespace-nowrap w-fit"
                    title="Vacía la cola de campos remotos pendientes (equivale a pulsar Clear en Ajustes de comunicación > Buffer en la máquina). No imprime nada."
                  >
                    {limpiandoBuffer
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Eraser className="h-3.5 w-3.5" />}
                    Limpiar buffer
                  </Button>
                  {bufferMensaje && (
                    <p className={`text-xs flex items-center gap-1 ${bufferMensaje.tipo === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                      {bufferMensaje.tipo === 'success' ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {bufferMensaje.texto}
                    </p>
                  )}
                </div>
              )}

              {/* Plantilla (mensaje) a cargar en la loteadora seleccionada */}
              {selectedLoteadora && (
                <div className="grid gap-1.5">
                  <label htmlFor="mensaje" className="text-xs font-semibold text-gray-700">
                    Plantilla
                    {loadingMensajes && <Loader2 className="inline h-3 w-3 animate-spin ml-1.5 text-gray-400" />}
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <SingleSelect
                        label="plantilla"
                        allLabel={mensajes.length === 0 ? 'Sin plantillas disponibles' : 'Seleccionar plantilla…'}
                        value={selectedMensaje || 'all'}
                        onChange={id => setSelectedMensaje(id === 'all' ? '' : id)}
                        options={mensajes.map(m => ({ id: m, description: m }))}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCargarMensaje}
                      disabled={!canCargarMensaje}
                      className="text-xs text-gray-600 whitespace-nowrap"
                    >
                      {cargandoMensaje
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Upload className="h-3.5 w-3.5" />}
                      Cargar plantilla
                    </Button>
                  </div>
                  {mensajeSuccess && (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Plantilla cargada correctamente
                    </p>
                  )}
                  {mensajeError && (
                    <p className="text-xs text-red-700 flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      {mensajeError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Columna derecha: preview + envío ── */}
            <div className="p-6 flex flex-col gap-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Vista previa de impresión</p>

              <div
                className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-4"
                style={{ borderLeft: '3px solid #D30B15', borderRadius: '0 8px 8px 0' }}
              >
                <div className="pb-3 border-b border-gray-200">
                  {selectedArticulo ? (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-gray-900 bg-gray-200 px-2 py-0.5 rounded">
                        {selectedArticulo.id}
                      </span>
                      <span className="text-sm font-semibold text-gray-800">{selectedArticulo.descripcion}</span>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">Ningún artículo seleccionado</span>
                  )}
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0 font-semibold uppercase tracking-wide">Lote</span>
                  <span className={`font-mono text-3xl font-bold tracking-widest ${lote ? 'text-gray-900' : 'text-gray-200'}`}>
                    {lote ?? '——'}
                  </span>
                </div>
                <div className="flex items-baseline gap-4">
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0 font-semibold uppercase tracking-wide">F. Cad.</span>
                  <span className={`font-mono text-3xl font-bold tracking-widest ${fechaCaducidad ? 'text-gray-900' : 'text-gray-200'}`}>
                    {fechaCaducidad ? formatDateES(fechaCaducidad) : '——'}
                  </span>
                </div>
              </div>

              {fabDate && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                    Año: {String(fabDate.getFullYear()).slice(-2)}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                    Día juliano: {toJulianDay(fabDate)}
                  </span>
                  {fechaCaducidad && (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                      {formatDateES(fabDate)} + {diasNum} días
                    </span>
                  )}
                </div>
              )}

              <div className="flex-1" />

              {enviado && !sendWarning && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 font-medium">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Mensaje enviado correctamente
                </div>
              )}

              {enviado && sendWarning && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 font-medium">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  Enviado, pero con aviso: {sendWarning}
                </div>
              )}

              {sendError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 font-medium space-y-1">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 flex-shrink-0" />
                    {sendError}
                  </div>
                  {sendErrorDetail && (
                    <div className="pl-6">
                      <button
                        type="button"
                        onClick={() => setShowSendErrorDetail(v => !v)}
                        className="text-xs font-normal underline text-red-600 hover:text-red-800"
                      >
                        {showSendErrorDetail ? 'Ocultar detalle' : 'Ver más'}
                      </button>
                      {showSendErrorDetail && (
                        <p className="text-xs font-normal font-mono text-red-600 mt-1">
                          Código de estado de la máquina: {sendErrorDetail}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handleEnviar}
                disabled={!canSend}
                className="w-full h-11 text-sm font-semibold text-white disabled:opacity-40"
                style={canSend ? { backgroundColor: '#D30B15' } : {}}
              >
                {sending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando...</>
                  : <><Send className="h-4 w-4" />Enviar a loteadora</>}
              </Button>
            </div>

          </div>
        </div>

        {/* Estado de las loteadoras (en vivo, se refresca solo cada 60s) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200" style={{ borderTop: '3px solid #D30B15' }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <Printer className="h-4 w-4" style={{ color: '#D30B15' }} />
              Estado de las loteadoras
              {loadingEstado && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
            </h2>
          </div>
          <div className="p-6">
            {estadoLoteadoras.length === 0 ? (
              <p className="text-sm text-gray-400">No hay loteadoras habilitadas configuradas en /admin.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {estadoLoteadoras.map(l => {
                  const info = ESTADO_INFO[l.state]
                  const Icon = info.icon
                  return (
                    <div key={l.id} className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-4 py-2.5">
                      <span className="text-sm font-medium text-gray-800 truncate">{l.name}</span>
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${info.className}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {info.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
