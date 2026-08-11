"use client"

import * as React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AppShell } from "@/components/AppShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/ui/empty-state"
import { ScanBarcode, Camera, AlertTriangle, CheckCircle2, PackageSearch, X } from "lucide-react"
import { parseGs1, type Gs1Fields } from "@/lib/gs1"

interface SessionUser { id: number; username: string; role: string; name: string; surname: string }

interface LoteStock {
    lote: string
    sscc: string | null
    cantidad: number
    fechaCaducidad: string | null
    ubicacion: string | null
    planta: string | null
}

interface ValidacionSscc {
    estado: 'correcto' | 'incorrecto' | 'no_encontrado' | 'sin_fecha'
    mensaje: string
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

// Resalta filas caducadas (rojo) o a punto de caducar (ámbar, dentro de DIAS_AVISO_CADUCIDAD días)
function filaCaducidadClassName(fecha: string | null): string {
    if (!fecha) return ""
    const d = new Date(fecha)
    if (isNaN(d.getTime())) return ""
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    d.setHours(0, 0, 0, 0)
    const diasRestantes = (d.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
    if (diasRestantes < 0) return "bg-red-50 hover:bg-red-100"
    if (diasRestantes <= DIAS_AVISO_CADUCIDAD) return "bg-amber-50 hover:bg-amber-100"
    return ""
}

// La caducidad manda si hay aviso; si no, resalta en tono de marca la fila del SSCC escaneado
function filaClassName(lote: LoteStock, ssccEscaneado: string | null | undefined): string {
    const porCaducidad = filaCaducidadClassName(lote.fechaCaducidad)
    if (porCaducidad) return porCaducidad
    if (ssccEscaneado && lote.sscc === ssccEscaneado) return "bg-primary/10 hover:bg-primary/15"
    return ""
}

export default function ConsultaStockPdaPage() {
    const router = useRouter()
    const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
    const [inputValue, setInputValue] = useState("")
    const [parsed, setParsed] = useState<Gs1Fields | null>(null)
    const [articulo, setArticulo] = useState<string | null>(null)
    const [descripcion, setDescripcion] = useState<string | null>(null)
    const [lotes, setLotes] = useState<LoteStock[]>([])
    const [validacionSscc, setValidacionSscc] = useState<ValidacionSscc | null>(null)
    const [planta, setPlanta] = useState("")
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

    // Comprobar sesión y permisos (mismo patrón que el resto de paneles)
    useEffect(() => {
        const checkAccess = async () => {
            try {
                const res = await fetch('/api/auth/me')
                const user = res.ok ? await res.json() : null
                if (user?.mustChangePassword) { router.push('/cambiar-contrasena'); return }
                setSessionUser(user)
                const screensRes = await fetch('/api/screen-permissions')
                if (screensRes.ok) {
                    const screens = await screensRes.json()
                    const mine = screens['consulta_stock_pda']
                    if (mine && !mine.is_public) {
                        if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
                            router.push('/login')
                            return
                        }
                    }
                }
            } catch { }
        }
        checkAccess()
    }, [])

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' })
        setSessionUser(null)
    }

    const fetchStock = useCallback(async (sscc: string) => {
        setLoading(true)
        setError(null)
        setArticulo(null)
        setDescripcion(null)
        setLotes([])
        setValidacionSscc(null)
        setSearched(true)
        try {
            const params = new URLSearchParams()
            params.set('sscc', sscc)
            if (planta) params.set('planta', planta)
            const res = await fetch(`/api/consulta-stock-pda?${params}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`)
            setArticulo(data.articulo)
            setDescripcion(data.descripcion)
            setLotes(data.lotes || [])
            setValidacionSscc(data.validacionSscc || null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error desconocido')
        } finally {
            setLoading(false)
        }
    }, [planta])

    // Procesa un código escaneado (da igual si viene del input HID o de la cámara):
    // lo parsea como GS1-128 y solo se busca por SSCC (número de palet, AI 00) — la API
    // valida además si ese palet concreto es correcto FEFO. Un EAN "pelado" del artículo,
    // sin SSCC, se rechaza: hay que escanear la etiqueta del palet, no la del artículo.
    const handleScan = useCallback((raw: string) => {
        const code = raw.trim()
        if (!code) return
        const fields = parseGs1(code)
        setParsed(fields)
        if (fields.sscc) {
            fetchStock(fields.sscc)
        } else {
            setError('Debes escanear el número de palet (SSCC), no el código del artículo')
            setArticulo(null)
            setLotes([])
        }
    }, [fetchStock])

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
        setLotes([])
        setValidacionSscc(null)
        setError(null)
        setSearched(false)
        setInputValue('')
        inputRef.current?.focus()
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

    const primerCaduca = lotes[0]?.fechaCaducidad || null

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
                            onChange={(e) => setPlanta(e.target.value)}
                            className="flex h-10 w-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                            <option value="">Todas</option>
                            {Object.entries(PLANTAS).map(([codigo, nombre]) => (
                                <option key={codigo} value={codigo}>{nombre}</option>
                            ))}
                        </select>
                    </div>
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

                {parsed && (
                    <div className="flex flex-wrap gap-2 text-xs">
                        {parsed.ean && <Badge variant="primary">EAN {parsed.ean}</Badge>}
                        {parsed.lote && <Badge>Lote {parsed.lote}</Badge>}
                        {parsed.cantidad != null && <Badge>Cant. {parsed.cantidad}</Badge>}
                        {parsed.sscc && <Badge variant="outline">SSCC {parsed.sscc}</Badge>}
                        {parsed.caducidad && <Badge variant="outline">Caduca {formatFecha(parsed.caducidad)}</Badge>}
                    </div>
                )}
            </Card>

            {error && (
                <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium">{error}</span>
                </div>
            )}

            {validacionSscc && (
                <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${validacionSscc.estado === 'correcto'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : validacionSscc.estado === 'sin_fecha'
                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                    {validacionSscc.estado === 'correcto'
                        ? <CheckCircle2 className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                        : <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />}
                    <span className="text-sm font-medium">{validacionSscc.mensaje}</span>
                </div>
            )}

            {loading && <Spinner label="Consultando stock en Reflex..." className="py-10" />}

            {!loading && articulo && (
                <Card accent className="overflow-hidden">
                    <CardHeader>
                        <CardTitle className="text-base">
                            {articulo}
                            {descripcion && <span className="ml-2 font-normal text-secondary-foreground">{descripcion}</span>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-bold text-secondary-foreground">Lote</TableHead>
                                        <TableHead className="font-bold text-secondary-foreground">SSCC</TableHead>
                                        <TableHead className="font-bold text-secondary-foreground">Cantidad</TableHead>
                                        <TableHead className="font-bold text-secondary-foreground">Caducidad</TableHead>
                                        <TableHead className="font-bold text-secondary-foreground">Ubicación</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {lotes.length === 0 ? (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={5}>
                                                <EmptyState icon={PackageSearch} title="Sin stock" description="No hay lotes en stock para este artículo." />
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        lotes.map((l, i) => (
                                            <TableRow key={`${l.sscc || l.lote}-${i}`} className={filaClassName(l, parsed?.sscc)}>
                                                <TableCell className="font-mono text-sm">{l.lote}</TableCell>
                                                <TableCell className="font-mono text-sm text-secondary-foreground">
                                                    {l.sscc ? l.sscc.slice(-6) : '-'}
                                                    {parsed?.sscc && l.sscc === parsed.sscc && (
                                                        <Badge variant="primary" className="ml-2">Escaneado</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm">{l.cantidad}</TableCell>
                                                <TableCell className="text-sm">
                                                    {formatFecha(l.fechaCaducidad)}
                                                    {l.fechaCaducidad === primerCaduca && (
                                                        <Badge variant="warning" className="ml-2">Primero en caducar</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-sm text-secondary-foreground">{l.ubicacion || '-'}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
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
        </AppShell>
    )
}
