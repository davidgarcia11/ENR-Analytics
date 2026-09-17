"use client"

import * as React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { RequireAccess, useApiFetch, useSession } from "@/components/SessionProvider"
import { AppShell } from "@/components/AppShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { Dialog } from "@/components/ui/dialog"
import {
    ScanBarcode, Camera, AlertTriangle, CheckCircle2, PackageSearch, X, ChevronDown, ChevronRight,
    XCircle, PackageX, HelpCircle, CalendarX, ShieldAlert, ArrowLeftRight, MapPinOff, type LucideIcon,
} from "lucide-react"
import { parseGs1, type Gs1Fields } from "@/lib/gs1"
import { plantReflexCode, FUNES_SUBPLANTS, funesSubplantLabel, plantHasSubplants } from "@/lib/plants"


interface PaletDetalle {
    lote: string
    sscc: string | null
    cantidad: number
    fechaCaducidad: string | null
    ubicacion: string | null
    planta: string | null
    subplanta: string | null
    caducado: boolean
    bloqueado: boolean
    primeroEnCaducar: boolean
}

interface GrupoLote {
    lote: string
    fechaCaducidad: string | null
    cantidadTotal: number
    cantidadBloqueada: number
    totalPalets: number
    paletsBloqueados: number
    palets: PaletDetalle[]
}

interface ValidacionSscc {
    estado: 'correcto' | 'aviso' | 'no_encontrado' | 'sin_fecha' | 'otra_subplanta'
    mensajes: string[]
    nota?: string
    subplantaReal?: string
}

// Código de depósito físico (Reflex) -> nombre de planta, igual que en app/api/consulta-stock-pda/route.ts
const PLANTAS: Record<string, string> = {
    '001': 'Aguilar',
    '002': 'Corella',
    '004': 'Funes',
    '006': 'Tudefrigo',
}

// Soporte de cámara: BarcodeDetector es API nativa del navegador (Chrome/Android),
// sin dependencias externas. Si no está disponible, solo se ofrece el input manual/HID.
function hasBarcodeDetector(): boolean {
    return typeof window !== "undefined" && "BarcodeDetector" in window
}

function formatFecha(fecha: string | null) {
    if (!fecha) return "-"
    const d = new Date(fecha)
    if (isNaN(d.getTime())) return fecha
    return d.toLocaleDateString("es-ES")
}

const DIAS_AVISO_CADUCIDAD = 5

function diasHastaCaducidad(fecha: string | null): number | null {
    if (!fecha) return null
    const d = new Date(fecha)
    if (isNaN(d.getTime())) return null
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    d.setHours(0, 0, 0, 0)
    return (d.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
}

// Resalta tarjetas caducadas (rojo) o a punto de caducar (ámbar, dentro de DIAS_AVISO_CADUCIDAD días)
function fondoCaducidadClassName(fecha: string | null): string {
    const dias = diasHastaCaducidad(fecha)
    if (dias === null) return ""
    if (dias < 0) return "bg-red-50"
    if (dias <= DIAS_AVISO_CADUCIDAD) return "bg-amber-50"
    return ""
}

// La caducidad manda si hay aviso; si no, resalta en tono de marca la tarjeta del SSCC escaneado
function paletClassName(palet: PaletDetalle, ssccEscaneado: string | null | undefined): string {
    const porCaducidad = fondoCaducidadClassName(palet.fechaCaducidad)
    if (porCaducidad) return porCaducidad
    if (ssccEscaneado && palet.sscc === ssccEscaneado) return "bg-primary/10"
    return "bg-card"
}

// Para que se vea claro qué lote se está leyendo SIN desplegarlo
function loteContieneEscaneado(grupo: GrupoLote, ssccEscaneado: string | null | undefined): boolean {
    return !!ssccEscaneado && grupo.palets.some(p => p.sscc === ssccEscaneado)
}

// Look & feel por estado, compartido entre el banner de la página y el pop-up obligatorio:
// icono + titular grande en el mismo color, para que "se puede o no consumir" se entienda
// de un vistazo sin tener que leer el texto.
const ESTADO_VISUAL: Record<ValidacionSscc['estado'], {
    Icon: LucideIcon; titulo: string
    iconBg: string; iconText: string; texto: string
    filaBorde: string; filaFondo: string
    botonClassName: string
}> = {
    correcto: {
        Icon: CheckCircle2, titulo: 'SE PUEDE CONSUMIR',
        iconBg: 'bg-green-100', iconText: 'text-green-600', texto: 'text-green-700',
        filaBorde: 'border-green-200', filaFondo: 'bg-green-50',
        botonClassName: 'bg-green-600 hover:bg-green-700 text-white',
    },
    aviso: {
        Icon: XCircle, titulo: 'NO SE PUEDE CONSUMIR',
        iconBg: 'bg-red-100', iconText: 'text-red-600', texto: 'text-red-700',
        filaBorde: 'border-red-200', filaFondo: 'bg-red-50',
        botonClassName: 'bg-red-600 hover:bg-red-700 text-white',
    },
    no_encontrado: {
        Icon: PackageX, titulo: 'PALET NO ENCONTRADO',
        iconBg: 'bg-red-100', iconText: 'text-red-600', texto: 'text-red-700',
        filaBorde: 'border-red-200', filaFondo: 'bg-red-50',
        botonClassName: 'bg-red-600 hover:bg-red-700 text-white',
    },
    sin_fecha: {
        Icon: HelpCircle, titulo: 'SIN FECHA DE CADUCIDAD',
        iconBg: 'bg-amber-100', iconText: 'text-amber-600', texto: 'text-amber-700',
        filaBorde: 'border-amber-200', filaFondo: 'bg-amber-50',
        botonClassName: 'bg-amber-500 hover:bg-amber-600 text-white',
    },
    // El palet existe pero está en la otra nave de Funes: no es un error del operario ni un
    // "no se puede consumir", es que está consultando la sub-planta equivocada (ámbar, no rojo).
    otra_subplanta: {
        Icon: MapPinOff, titulo: 'ESTÁ EN OTRA SUB-PLANTA',
        iconBg: 'bg-amber-100', iconText: 'text-amber-600', texto: 'text-amber-700',
        filaBorde: 'border-amber-200', filaFondo: 'bg-amber-50',
        botonClassName: 'bg-amber-500 hover:bg-amber-600 text-white',
    },
}

// Icono por motivo concreto dentro de un aviso (un palet puede acumular varios a la vez:
// caducado + bloqueado, por ejemplo — cada mensaje se muestra en su propia fila con su icono).
function iconoMensaje(mensaje: string): LucideIcon {
    if (mensaje.includes('Caducado')) return CalendarX
    if (mensaje.includes('lote está en')) return MapPinOff
    if (mensaje.includes('bloqueado por Calidad')) return ShieldAlert
    if (mensaje.includes('caducan antes')) return ArrowLeftRight
    return AlertTriangle
}

function ConsultaStockPdaPanel() {
    const { user: sessionUser, logout } = useSession()
    const apiFetch = useApiFetch()
    const [inputValue, setInputValue] = useState("")
    const [parsed, setParsed] = useState<Gs1Fields | null>(null)
    const [articulo, setArticulo] = useState<string | null>(null)
    const [descripcion, setDescripcion] = useState<string | null>(null)
    const [grupos, setGrupos] = useState<GrupoLote[]>([])
    const [expandedLotes, setExpandedLotes] = useState<Set<string>>(new Set())
    const [loteEscaneado, setLoteEscaneado] = useState<string | null>(null)
    const [validacionSscc, setValidacionSscc] = useState<ValidacionSscc | null>(null)
    const [ackOpen, setAckOpen] = useState(false)
    const [planta, setPlanta] = useState(plantReflexCode(sessionUser?.defaultPlant) || "")
    const [subplanta, setSubplanta] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [cameraOpen, setCameraOpen] = useState(false)
    const [cameraSupported, setCameraSupported] = useState(false)
    const [searched, setSearched] = useState(false)

    const inputRef = useRef<HTMLInputElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const rafRef = useRef<number | null>(null)

    useEffect(() => {
        setCameraSupported(hasBarcodeDetector())
        inputRef.current?.focus()
    }, [])

    // Funes tiene dos naves y el stock del mismo artículo se reparte entre ellas, así que
    // hay que saber en cuál está el operario antes de poder decirle qué palet coger (ver
    // docs/consulta-stock-pda.md §7.5). El resto de plantas no se subdividen.
    const requiereSubplanta = plantHasSubplants(planta)
    const faltaElegirSubplanta = requiereSubplanta && !subplanta

    // Al cambiar de planta, la sub-planta elegida deja de tener sentido
    const handlePlantaChange = (nuevaPlanta: string) => {
        setPlanta(nuevaPlanta)
        setSubplanta("")
    }

    // subplantaOverride: se usa al cambiar de sub-planta desde el pop-up "está en otra
    // sub-planta", donde hay que relanzar la consulta con el valor nuevo antes de que el
    // estado se refleje en este cierre (closure).
    const fetchStock = useCallback(async (sscc: string, subplantaOverride?: string) => {
        const subplantaEfectiva = subplantaOverride ?? subplanta
        setLoading(true)
        setError(null)
        setArticulo(null)
        setDescripcion(null)
        setGrupos([])
        setExpandedLotes(new Set())
        setLoteEscaneado(null)
        setValidacionSscc(null)
        setSearched(true)
        try {
            const params = new URLSearchParams()
            params.set('sscc', sscc)
            if (planta) params.set('planta', planta)
            if (subplantaEfectiva) params.set('subplanta', subplantaEfectiva)
            const res = await apiFetch(`/api/consulta-stock-pda?${params}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
            setArticulo(data.articulo)
            setDescripcion(data.descripcion)
            const gruposRecibidos: GrupoLote[] = data.grupos || []
            setGrupos(gruposRecibidos)
            // El lote del palet escaneado empieza desplegado, el resto colapsado
            const loteDelEscaneado = gruposRecibidos.find(g => g.palets.some(p => p.sscc === sscc))?.lote ?? null
            setExpandedLotes(loteDelEscaneado ? new Set([loteDelEscaneado]) : new Set())
            setLoteEscaneado(loteDelEscaneado)
            if (data.validacionSscc) {
                setValidacionSscc(data.validacionSscc)
                setAckOpen(true)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error desconocido')
        } finally {
            setLoading(false)
        }
    }, [planta, subplanta])

    // Procesa un código escaneado (da igual si viene del input HID o de la cámara):
    // lo parsea como GS1-128 y solo se busca por SSCC (número de palet, AI 00) — la API
    // valida además si ese palet concreto es correcto FEFO. Un EAN "pelado" del artículo,
    // sin SSCC, se rechaza: hay que escanear la etiqueta del palet, no la del artículo.
    const handleScan = useCallback((raw: string) => {
        const code = raw.trim()
        if (!code) return
        // En Funes, sin saber la nave no se puede responder "qué palet coger" — se rechaza el
        // escaneo antes de consultar, en vez de dar una respuesta que mezcla las dos naves.
        if (faltaElegirSubplanta) {
            setError('Elige primero en qué sub-planta de Funes estás')
            return
        }
        const fields = parseGs1(code)
        setParsed(fields)
        if (fields.sscc) {
            fetchStock(fields.sscc)
        } else {
            setError('Debes escanear el número de palet (SSCC), no el código del artículo')
            setArticulo(null)
            setGrupos([])
        }
    }, [fetchStock, faltaElegirSubplanta])

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleScan(inputValue)
            setInputValue('')
        }
    }

    const clearAll = () => {
        setParsed(null)
        setArticulo(null)
        setDescripcion(null)
        setGrupos([])
        setExpandedLotes(new Set())
        setLoteEscaneado(null)
        setValidacionSscc(null)
        setAckOpen(false)
        setError(null)
        setSearched(false)
        setInputValue('')
        inputRef.current?.focus()
    }

    const toggleLote = (lote: string) => setExpandedLotes(prev => {
        const next = new Set(prev)
        next.has(lote) ? next.delete(lote) : next.add(lote)
        return next
    })

    // Deja constancia de quién aceptó el pop-up y con qué mensaje, para poder saber a quién
    // le salió un aviso concreto si luego el producto se mete erróneamente en línea.
    // Best-effort: un fallo de red no debe atrapar al operario en el pop-up.
    const acceptAck = async () => {
        setAckOpen(false)
        if (!validacionSscc || !parsed?.sscc) return
        try {
            await apiFetch('/api/consulta-stock-pda/confirmaciones', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sscc: parsed.sscc,
                    articulo,
                    estado: validacionSscc.estado,
                    mensajes: validacionSscc.mensajes,
                }),
            })
        } catch { /* trazabilidad best-effort */ }
    }

    // "Ver en <otra sub-planta>" del pop-up: el palet estaba en la otra nave, así que el
    // operario probablemente se ha movido y no cambió el selector. Se registra la confirmación
    // igual (queda constancia del aviso que vio) y se relanza la consulta ya en la nave correcta.
    const cambiarASubplantaReal = async () => {
        const destino = validacionSscc?.subplantaReal
        const ssccActual = parsed?.sscc
        await acceptAck()
        if (!destino || !ssccActual) return
        setSubplanta(destino)
        fetchStock(ssccActual, destino)
    }

    // --- Escaneo por cámara (API nativa BarcodeDetector, sin dependencias) ---
    const stopCamera = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        setCameraOpen(false)
    }, [])

    const startCamera = useCallback(async () => {
        if (!hasBarcodeDetector()) return
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            streamRef.current = stream
            setCameraOpen(true)
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
            }
            // @ts-expect-error BarcodeDetector todavía no está en los tipos estándar de TypeScript
            const detector = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8'] })
            const tick = async () => {
                if (!videoRef.current || !streamRef.current) return
                try {
                    const codes = await detector.detect(videoRef.current)
                    if (codes.length > 0) {
                        handleScan(codes[0].rawValue)
                        stopCamera()
                        return
                    }
                } catch { /* frame sin código legible, seguimos intentando */ }
                rafRef.current = requestAnimationFrame(tick)
            }
            rafRef.current = requestAnimationFrame(tick)
        } catch {
            setError('No se pudo acceder a la cámara')
        }
    }, [handleScan, stopCamera])

    useEffect(() => stopCamera, [stopCamera]) // liberar la cámara al desmontar

    return (
        <AppShell
            navbar={{
                currentPanel: "consulta_stock_pda",
                user: sessionUser,
                onLogout: logout,
            }}
            title="Consulta de stock por escaneo"
            description="Escanea el código de barras de un palet para ver el artículo y sus lotes ordenados por caducidad (FEFO)"
        >
            <Card accent className="p-4 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                    <div className="grid gap-1.5 flex-1 min-w-[240px]">
                        <label htmlFor="scan-input" className="text-xs font-semibold text-secondary-foreground">
                            Escanear código de barras
                        </label>
                        <input
                            id="scan-input"
                            ref={inputRef}
                            type="text"
                            autoComplete="off"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            placeholder="Pulsa aquí y escanea la etiqueta del palet (SSCC), o teclea el código + Enter"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <label htmlFor="planta-select" className="text-xs font-semibold text-secondary-foreground">
                            Planta
                        </label>
                        <select
                            id="planta-select"
                            value={planta}
                            onChange={(e) => handlePlantaChange(e.target.value)}
                            className="flex h-10 w-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                            <option value="">Todas</option>
                            {Object.entries(PLANTAS).map(([codigo, nombre]) => (
                                <option key={codigo} value={codigo}>{nombre}</option>
                            ))}
                        </select>
                    </div>
                    {requiereSubplanta && (
                        <div className="grid gap-1.5">
                            <label htmlFor="subplanta-select" className="text-xs font-semibold text-secondary-foreground">
                                Sub-planta
                            </label>
                            <select
                                id="subplanta-select"
                                value={subplanta}
                                onChange={(e) => setSubplanta(e.target.value)}
                                aria-invalid={faltaElegirSubplanta}
                                className={`flex h-10 w-[160px] rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${faltaElegirSubplanta ? 'border-amber-400 ring-1 ring-amber-300' : 'border-input'}`}
                            >
                                <option value="">¿Dónde estás?</option>
                                {FUNES_SUBPLANTS.map(s => (
                                    <option key={s.reflex} value={s.reflex}>{s.label}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex gap-2">
                        {cameraSupported && !cameraOpen && (
                            <Button type="button" variant="outline" onClick={startCamera}>
                                <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                                Cámara
                            </Button>
                        )}
                        {cameraOpen && (
                            <Button type="button" variant="outline" onClick={stopCamera}>
                                <X className="mr-2 h-4 w-4" aria-hidden="true" />
                                Cerrar cámara
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={clearAll}>
                            Limpiar
                        </Button>
                    </div>
                </div>

                {cameraOpen && (
                    <video ref={videoRef} className="w-full max-w-sm rounded-md border border-border" muted playsInline />
                )}

                {faltaElegirSubplanta && (
                    <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                        <MapPinOff className="h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden="true" />
                        <div className="text-sm">
                            <div className="font-bold text-amber-700">Elige en qué sub-planta estás</div>
                            <div className="text-secondary-foreground">
                                Funes tiene dos naves y el mismo artículo puede estar en las dos. Sin saber dónde estás
                                no se puede decir qué palet coger.
                            </div>
                        </div>
                    </div>
                )}

                {parsed && (
                    <div className="flex flex-wrap gap-2 text-xs">
                        {parsed.ean && <Badge variant="primary">EAN {parsed.ean}</Badge>}
                        {parsed.lote && <Badge>Lote {parsed.lote}</Badge>}
                        {parsed.cantidad != null && <Badge>Cant. {parsed.cantidad}</Badge>}
                        {parsed.sscc && <Badge variant="outline">SSCC {parsed.sscc}</Badge>}
                        {parsed.caducidad && <Badge variant="outline">Caduca {formatFecha(parsed.caducidad)}</Badge>}
                        {subplanta && <Badge variant="outline">{funesSubplantLabel(subplanta)}</Badge>}
                    </div>
                )}
            </Card>

            {error && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">{error}</span>
                </div>
            )}

            {validacionSscc && (() => {
                const v = ESTADO_VISUAL[validacionSscc.estado]
                return (
                    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${v.filaBorde} ${v.filaFondo}`}>
                        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${v.iconBg}`}>
                            <v.Icon className={`h-5 w-5 ${v.iconText}`} aria-hidden="true" />
                        </div>
                        <div>
                            <div className={`text-sm font-black tracking-wide ${v.texto}`}>{v.titulo}</div>
                            {validacionSscc.estado !== 'correcto' && (
                                <div className="mt-0.5 space-y-0.5">
                                    {validacionSscc.mensajes.map((m, i) => (
                                        <div key={i} className="text-sm font-medium text-secondary-foreground">{m}</div>
                                    ))}
                                </div>
                            )}
                            {/* La nota se muestra en cualquier estado, incluido "correcto" */}
                            {validacionSscc.nota && (
                                <div className="mt-0.5 text-sm text-muted-foreground">{validacionSscc.nota}</div>
                            )}
                        </div>
                    </div>
                )
            })()}

            {loading && <Spinner label="Consultando stock en Reflex..." className="py-10" />}

            {!loading && articulo && (
                <Card accent className="overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-base">
                            {articulo}
                            {descripcion && <span className="ml-2 font-normal text-secondary-foreground">{descripcion}</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {grupos.length === 0 ? (
                            <EmptyState icon={PackageSearch} title="Sin stock" description="No hay lotes en stock para este artículo." />
                        ) : (
                            grupos.map(grupo => {
                                const escaneado = loteContieneEscaneado(grupo, parsed?.sscc)
                                return (
                                    <div
                                        key={grupo.lote}
                                        className={`rounded-lg border ${escaneado ? 'border-primary ring-1 ring-primary' : 'border-border'} ${fondoCaducidadClassName(grupo.fechaCaducidad) || 'bg-card'}`}
                                    >
                                        {/* Cabecera del lote — toda la info clave visible sin desplegar, sin scroll horizontal */}
                                        <div
                                            className="flex cursor-pointer items-start justify-between gap-2 p-3"
                                            onClick={() => toggleLote(grupo.lote)}
                                        >
                                            <div className="flex min-w-0 items-start gap-2">
                                                {expandedLotes.has(grupo.lote)
                                                    ? <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                                                    : <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="font-mono text-sm font-bold text-foreground">{grupo.lote}</span>
                                                        {escaneado && <Badge variant="primary">Escaneado</Badge>}
                                                    </div>
                                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary-foreground">
                                                        <span>Caducidad: {formatFecha(grupo.fechaCaducidad)}</span>
                                                        {grupo.palets.some(p => p.caducado) && <Badge variant="destructive">Caducado</Badge>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0 text-right">
                                                <div className="text-sm font-bold text-foreground">{grupo.cantidadTotal}</div>
                                                <div className="mt-1 flex flex-col items-end gap-1">
                                                    {grupo.paletsBloqueados > 0 && (
                                                        <Badge variant="destructive">{grupo.paletsBloqueados}/{grupo.totalPalets} bloqueados</Badge>
                                                    )}
                                                    {grupo.cantidadBloqueada > 0 && (
                                                        <Badge variant="destructive">{grupo.cantidadBloqueada}/{grupo.cantidadTotal} bloqueada</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Detalle por palet — desplegable, también en tarjetas apiladas (nunca en columnas fijas) */}
                                        {expandedLotes.has(grupo.lote) && (
                                            <div className="space-y-1.5 border-t border-border p-3 pt-2.5">
                                                {grupo.palets.map((p, i) => (
                                                    <div key={p.sscc || i} className={`rounded-md border border-border/60 p-2 ${paletClassName(p, parsed?.sscc)}`}>
                                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                                            <span className="font-mono text-xs text-secondary-foreground">SSCC {p.sscc || '-'}</span>
                                                            <span className="text-sm font-bold text-foreground">{p.cantidad}</span>
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                                            <span className="text-xs text-secondary-foreground">{formatFecha(p.fechaCaducidad)}</span>
                                                            {p.caducado && <Badge variant="destructive">Caducado</Badge>}
                                                            {!p.caducado && p.primeroEnCaducar && <Badge variant="warning">Primero en caducar</Badge>}
                                                            {parsed?.sscc && p.sscc === parsed.sscc && <Badge variant="primary">Escaneado</Badge>}
                                                            {p.bloqueado && <Badge variant="destructive">Bloqueado por Calidad</Badge>}
                                                        </div>
                                                        {p.ubicacion && <div className="mt-1 text-xs text-muted-foreground">{p.ubicacion}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })
                        )}
                    </CardContent>
                </Card>
            )}

            {!loading && !articulo && !error && searched && (
                <EmptyState
                    icon={PackageSearch}
                    title="Sin stock para este palet"
                    description="Se ha buscado, pero no hay artículo/stock registrado para ese código en esta base de datos."
                    className="py-16"
                />
            )}

            {!loading && !articulo && !error && !searched && (
                <EmptyState
                    icon={ScanBarcode}
                    title="Sin escaneo todavía"
                    description="Escanea el código de barras de un palet para consultar su stock."
                    className="py-16"
                />
            )}

            <Dialog
                open={ackOpen}
                onOpenChange={setAckOpen}
                dismissible={false}
                title={parsed?.sscc
                    ? `Palet ${parsed.sscc}${loteEscaneado ? ` · Lote ${loteEscaneado}` : ''}${subplanta ? ` · ${funesSubplantLabel(subplanta)}` : ''}`
                    : 'Resultado del escaneo'}
                footer={validacionSscc && (
                    <div className="flex w-full flex-col gap-2">
                        {/* El palet está en la otra nave: atajo para cambiar de sub-planta sin
                            volver a escanear (el operario se ha movido y no tocó el selector) */}
                        {validacionSscc.estado === 'otra_subplanta' && validacionSscc.subplantaReal && (
                            <Button onClick={cambiarASubplantaReal} size="lg" variant="outline" className="w-full font-bold">
                                Ver en {funesSubplantLabel(validacionSscc.subplantaReal)}
                            </Button>
                        )}
                        <Button onClick={acceptAck} size="lg" className={`w-full font-bold ${ESTADO_VISUAL[validacionSscc.estado].botonClassName}`}>
                            Aceptar
                        </Button>
                    </div>
                )}
            >
                {validacionSscc && (() => {
                    const v = ESTADO_VISUAL[validacionSscc.estado]
                    return (
                        <div className="flex flex-col items-center gap-3 py-2 text-center">
                            <div className={`flex h-16 w-16 items-center justify-center rounded-full ${v.iconBg}`}>
                                <v.Icon className={`h-9 w-9 ${v.iconText}`} aria-hidden="true" />
                            </div>
                            <div className={`text-xl font-black tracking-wide ${v.texto}`}>{v.titulo}</div>
                            {validacionSscc.estado !== 'correcto' && (
                                <div className="w-full space-y-1.5">
                                    {validacionSscc.mensajes.map((m, i) => {
                                        const Icon = iconoMensaje(m)
                                        return (
                                            <div key={i} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium text-foreground ${v.filaBorde} ${v.filaFondo}`}>
                                                <Icon className={`h-4 w-4 flex-shrink-0 ${v.iconText}`} aria-hidden="true" />
                                                <span>{m}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                            {/* La nota se muestra en cualquier estado, incluido "correcto" */}
                            {validacionSscc.nota && (
                                <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-sm text-secondary-foreground">
                                    <MapPinOff className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span>{validacionSscc.nota}</span>
                                </div>
                            )}
                        </div>
                    )
                })()}
            </Dialog>
        </AppShell>
    )
}

export default function ConsultaStockPdaPage() {
    return (
        <RequireAccess screen="consulta_stock_pda">
            <ConsultaStockPdaPanel />
        </RequireAccess>
    )
}
