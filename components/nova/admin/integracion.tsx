"use client";

// /admin → Integración › Mensajes recibidos: los mensajes recibidos por la API de
// integración (POST /api/integracion/v1/escaneo), válidos o no, tal cual llegaron.
// Solo lectura, con el permiso 'admin.integracion.ver'. Por ahora el panel no hace
// nada con ellos. Datos: lib/integracion.ts.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";
import type { FilaMensaje } from "@/lib/integracion";

// La fecha se guarda en UTC ("AAAA-MM-DD HH:MM:SS"): se enseña en hora local
const fechaLocal = (utc: string) => new Date(utc.replace(" ", "T") + "Z").toLocaleString("es-ES", {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

const ORIGEN_ITEMS = [{ value: "", label: "Reales y de prueba" }, { value: "real", label: "Solo reales" }, { value: "prueba", label: "Solo de prueba" }];
const VALIDO_ITEMS = [{ value: "", label: "Todos" }, { value: "1", label: "Correctos" }, { value: "0", label: "Con errores" }];

// Los datos principales de un escaneo, en corto; si el cuerpo no es JSON, nada
function resumen(cuerpo: string): { clave: string; valor: string }[] {
  try {
    const d = JSON.parse(cuerpo);
    return ["articulo", "resultado", "linea", "lote", "sscc", "orden"]
      .filter((k) => d?.[k] !== undefined && d[k] !== "")
      .map((k) => ({ clave: k, valor: String(d[k]) }));
  } catch { return []; }
}

export default function AdminIntegracion({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [filtros, setFiltros] = useState({ origen: "", valido: "", desde: "", hasta: "", q: "" });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ filas: FilaMensaje[]; total: number; porPagina: number }>({ filas: [], total: 0, porPagina: 50 });
  const [cargando, setCargando] = useState(true);

  // Se busca al cambiar un filtro (con una pequeña espera para el de texto) o de página
  useEffect(() => {
    let vigente = true;
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams({ ...filtros, pagina: String(pagina) });
        const res = await apiFetch(`/api/admin/integracion?${params}`);
        if (vigente && res.ok) setDatos(await res.json());
      } finally { if (vigente) setCargando(false); }
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros, pagina]);

  const cambiar = (k: keyof typeof filtros, v: string) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };
  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />
      <TablaCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select items={ORIGEN_ITEMS} value={filtros.origen} onValueChange={(v) => cambiar("origen", (v as string) ?? "")}>
              <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORIGEN_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select items={VALIDO_ITEMS} value={filtros.valido} onValueChange={(v) => cambiar("valido", (v as string) ?? "")}>
              <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VALIDO_ITEMS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filtros.desde} onChange={(e) => cambiar("desde", e.target.value)} className="h-8 w-36" aria-label="Desde" title="Desde" />
            <Input type="date" value={filtros.hasta} onChange={(e) => cambiar("hasta", e.target.value)} className="h-8 w-36" aria-label="Hasta" title="Hasta" />
            <Input value={filtros.q} onChange={(e) => cambiar("q", e.target.value)} placeholder="Artículo, lote, SSCC…" className="h-8 w-52" />
          </div>
        }
        extra={cargando ? "Buscando…" : `${datos.total} mensaje${datos.total === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Datos</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando && datos.filas.length === 0 ? (
              <FilaVacia colSpan={4} cargando />
            ) : datos.filas.length === 0 ? (
              <FilaVacia colSpan={4} texto="No hay mensajes con estos filtros" />
            ) : (
              datos.filas.map((f) => (
                <TableRow key={f.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-sm">
                    {fechaLocal(f.fecha)}
                    {f.ip && <span className="block text-xs text-muted-foreground" title="IP que declara la petición (x-forwarded-for): orientativa, no comprobada">{f.ip}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm font-medium text-foreground">{f.tipo}</span>
                    {f.origen === "prueba" && <Badge variant="outline" className="mt-1 font-normal">Prueba</Badge>}
                    {f.claveNombre && <span className="mt-1 block text-xs text-muted-foreground" title="Clave con la que llegó">{f.claveNombre}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-xl flex-wrap gap-x-3 gap-y-0.5 text-sm">
                      {resumen(f.cuerpo).map((d) => (
                        <span key={d.clave}><span className="text-muted-foreground">{d.clave}:</span> <span className="font-mono text-foreground">{d.valor}</span></span>
                      ))}
                    </div>
                    {/* Lo recibido tal cual, para revisarlo con quien lo envió */}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">JSON recibido</summary>
                      <pre className="mt-1 max-w-xl overflow-x-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">{f.cuerpo}</pre>
                    </details>
                  </TableCell>
                  <TableCell>
                    {f.valido
                      ? <Badge className="bg-emerald-400/10 text-emerald-600">Recibido</Badge>
                      : <Badge className="bg-rose-400/10 text-rose-500">Rechazado</Badge>}
                    {f.errores?.map((e) => <span key={e} className="mt-1 block max-w-64 text-xs text-muted-foreground">{e}</span>)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {paginas > 1 && (
          <div className="flex items-center justify-end gap-2 border-t p-3 text-sm text-muted-foreground">
            Página {pagina} de {paginas}
            <Button variant="outline" size="icon-sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} aria-label="Más recientes"><ChevronLeft /></Button>
            <Button variant="outline" size="icon-sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Más antiguos"><ChevronRight /></Button>
          </div>
        )}
      </TablaCard>
    </>
  );
}
