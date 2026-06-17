"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tag, CheckCircle2, XCircle, Loader2, Send, AlertTriangle, Calendar } from "lucide-react"
import Navbar from "@/components/Navbar"
import { useRouter } from "next/navigation"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

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

  // Formulario
  const [articulo, setArticulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fechaFab, setFechaFab] = useState(todayISO())
  const [diasCad, setDiasCad] = useState('')
  const [diasDesdeJde, setDiasDesdeJde] = useState<number | null>(null)
  const [modoManual, setModoManual] = useState(false)

  // Estado JDE
  const [jdeOnline, setJdeOnline] = useState(true)
  const [loadingArticulo, setLoadingArticulo] = useState(false)

  // Envío
  const [sending, setSending] = useState(false)
  const [enviado, setEnviado] = useState(false)

  useEffect(() => { checkSession() }, [])

  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setSessionUser(data.user)
      } else {
        router.push('/login')
      }
    } catch { router.push('/login') }
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  // Cálculos derivados
  const fabDate = parseFecha(fechaFab)
  const diasNum = parseInt(diasCad, 10)
  const lote = fabDate ? toLote(fabDate) : null
  const fechaCaducidad = (fabDate && !isNaN(diasNum) && diasNum > 0) ? addDays(fabDate, diasNum) : null
  const canSend = !!lote && !!fechaCaducidad && !sending
  const articuloValido = /^\d{10}$/.test(articulo)
  const diasReadonly = !modoManual && jdeOnline && diasDesdeJde !== null

  const handleArticuloBlur = async () => {
    if (!articuloValido) {
      setDescripcion('')
      setDiasDesdeJde(null)
      if (!modoManual) setDiasCad('')
      return
    }
    setLoadingArticulo(true)
    try {
      // TODO: reemplazar con /api/loteadora/articulo?code=<articulo>
      const res = await fetch(`/api/jde-orders?articulo=${articulo}`)
      if (!res.ok) throw new Error()
      // ponytail: mock hasta conectar endpoint real
      setDescripcion('Artículo cargado desde JDE')
      const dias = 90
      setDiasDesdeJde(dias)
      setJdeOnline(true)
      if (!modoManual) setDiasCad(String(dias))
    } catch {
      setJdeOnline(false)
      setDescripcion('')
      setDiasDesdeJde(null)
      setModoManual(true)
    } finally {
      setLoadingArticulo(false)
    }
  }

  const limpiarArticulo = () => {
    setArticulo('')
    setDescripcion('')
    setDiasDesdeJde(null)
    setDiasCad('')
    setModoManual(false)
  }

  const handleEnviar = async () => {
    if (!canSend || !lote || !fechaCaducidad) return
    setSending(true)
    try {
      // TODO: conectar con el endpoint de la loteadora
      await new Promise(r => setTimeout(r, 600))
      setEnviado(true)
      setTimeout(() => setEnviado(false), 3000)
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
      <div className="mx-auto max-w-5xl space-y-8">

        <Navbar currentPanel="loteadora" user={sessionUser} onLogout={logout} />

        {/* Tarjeta principal */}
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
                : <><XCircle className="h-3.5 w-3.5" />JDE caído</>
              }
            </div>
          </div>

          {/* Cuerpo en 2 columnas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">

            {/* ── Columna izquierda: formulario ── */}
            <div className="p-6 space-y-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Datos del artículo</p>

              {/* Código artículo */}
              <div className="grid gap-1.5">
                <label htmlFor="articulo" className="text-xs font-semibold text-gray-700">Código de artículo</label>
                <Input
                  id="articulo"
                  value={articulo}
                  onChange={e => {
                    setArticulo(e.target.value)
                    setDescripcion('')
                    setDiasDesdeJde(null)
                    if (!modoManual) setDiasCad('')
                  }}
                  onBlur={handleArticuloBlur}
                  placeholder="0000000000"
                  maxLength={10}
                  className="font-mono tracking-widest"
                />
                {loadingArticulo && (
                  <p className="text-xs text-gray-400 flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Consultando JDE...
                  </p>
                )}
                {!loadingArticulo && articuloValido && (
                  <p className={`text-xs ${descripcion ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>
                    {descripcion || 'Artículo no encontrado en JDE'}
                  </p>
                )}
                {articulo && (
                  <button
                    type="button"
                    onClick={limpiarArticulo}
                    className="text-xs text-gray-400 hover:text-gray-600 text-left underline w-fit"
                  >
                    Limpiar
                  </button>
                )}
              </div>

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
                    <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                      desde JDE
                    </span>
                  )}
                  {(!jdeOnline || modoManual) && (
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      manual
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
                  <button
                    type="button"
                    onClick={() => setModoManual(true)}
                    className="text-xs text-gray-400 hover:text-gray-600 text-left underline w-fit"
                  >
                    Introducir manualmente
                  </button>
                )}
                {modoManual && diasDesdeJde !== null && (
                  <button
                    type="button"
                    onClick={() => { setModoManual(false); setDiasCad(String(diasDesdeJde)) }}
                    className="text-xs text-gray-400 hover:text-gray-600 text-left underline w-fit"
                  >
                    Usar valor de JDE ({diasDesdeJde} días)
                  </button>
                )}
              </div>
            </div>

            {/* ── Columna derecha: preview + envío ── */}
            <div className="p-6 flex flex-col gap-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Vista previa de impresión</p>

              {/* Etiqueta preview */}
              <div
                className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-4"
                style={{ borderLeft: '3px solid #D30B15', borderRadius: '0 8px 8px 0' }}
              >
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

              {/* Chips de desglose del cálculo */}
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

              {/* Banner de éxito */}
              {enviado && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 font-medium">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  Mensaje enviado correctamente
                </div>
              )}

              {/* Botón enviar */}
              <Button
                onClick={handleEnviar}
                disabled={!canSend}
                className="w-full h-11 text-sm font-semibold text-white disabled:opacity-40"
                style={canSend ? { backgroundColor: '#D30B15' } : {}}
              >
                {sending
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Enviando...</>
                  : <><Send className="h-4 w-4" />Enviar a loteadora</>
                }
              </Button>
            </div>

          </div>
        </div>
      </div>
    </main>
  )
}
