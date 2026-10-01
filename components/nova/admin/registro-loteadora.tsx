"use client";

// /admin → Loteadora › Registro: todo lo enviado a las loteadoras desde /loteadora
// (qué, a qué máquina, cuándo, quién y cómo fue), con filtros. Solo lectura, con el
// permiso 'admin.loteadora.registro.ver'. Datos: lib/loteadora-registro.ts.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";
import type { FilaRegistro } from "@/lib/loteadora-registro";

const RESULTADO: Record<FilaRegistro["resultado"], { label: string; className: string }> = {
  ok: { label: "Correcto", className: "bg-emerald-400/10 text-emerald-600" },
  aviso: { label: "Con aviso", className: "bg-amber-400/10 text-amber-600" },
  error: { label: "Error", className: "bg-rose-400/10 text-rose-500" },
};

// La fecha se guarda en UTC ("AAAA-MM-DD HH:MM:SS"): se enseña en hora local
const fechaLocal = (utc: string) => new Date(utc.replace(" ", "T") + "Z").toLocaleString("es-ES", {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
});

// Lo rellenado, en corto: "Lote 263221 · Cocida 26/364 · Turno 1 · Cad. 2027-01-06"
function resumenDatos(d: Record<string, any>): string {
  const partes: string[] = [];
  if (d.fresco) partes.push(`Lote ${d.fresco}`);
  if (d.cocidaDia) partes.push(`Cocida ${String(d.cocidaAnio ?? "").slice(-2)}/${d.cocidaDia}`);
  if (d.turno) partes.push(`Turno ${d.turno}`);
  if (d.caducidad) partes.push(`Cad. ${d.caducidad}`);
  for (const [nombre, valor] of Object.entries(d.manuales ?? {})) partes.push(`${nombre}: ${valor}`);
  return partes.join(" · ");
}

export default function AdminRegistroLoteadora({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [filtros, setFiltros] = useState({ loteadoraId: "", desde: "", hasta: "", usuario: "", q: "" });
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ filas: FilaRegistro[]; total: number; porPagina: number; maquinas: { id: number; nombre: string }[] }>(
    { filas: [], total: 0, porPagina: 50, maquinas: [] },
  );
  const [cargando, setCargando] = useState(true);

  // Se busca al cambiar un filtro (con una pequeña espera para los de texto) o de página
  useEffect(() => {
    let vigente = true;
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams({ ...filtros, pagina: String(pagina) });
        const res = await apiFetch(`/api/admin/loteadora-registro?${params}`);
        if (vigente && res.ok) setDatos(await res.json());
      } finally { if (vigente) setCargando(false); }
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros, pagina]);

  const cambiar = (k: keyof typeof filtros, v: string) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };
  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));
  const maquinaItems = [{ value: "", label: "Todas las máquinas" }, ...datos.maquinas.map((m) => ({ value: String(m.id), label: m.nombre }))];

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />
      <TablaCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select items={maquinaItems} value={filtros.loteadoraId} onValueChange={(v) => cambiar("loteadoraId", (v as string) ?? "")}>
              <SelectTrigger size="sm" className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {maquinaItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filtros.desde} onChange={(e) => cambiar("desde", e.target.value)} className="h-8 w-36" aria-label="Desde" title="Desde" />
            <Input type="date" value={filtros.hasta} onChange={(e) => cambiar("hasta", e.target.value)} className="h-8 w-36" aria-label="Hasta" title="Hasta" />
            <Input value={filtros.usuario} onChange={(e) => cambiar("usuario", e.target.value)} placeholder="Usuario" className="h-8 w-36" />
            <Input value={filtros.q} onChange={(e) => cambiar("q", e.target.value)} placeholder="Artículo, lote, plantilla…" className="h-8 w-52" />
          </div>
        }
        extra={cargando ? "Buscando…" : `${datos.total} envío${datos.total === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Máquina</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Artículo</TableHead>
              <TableHead>Lo enviado</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando && datos.filas.length === 0 ? (
              <FilaVacia colSpan={6} cargando />
            ) : datos.filas.length === 0 ? (
              <FilaVacia colSpan={6} texto="No hay envíos con estos filtros" />
            ) : (
              datos.filas.map((f) => (
                <TableRow key={f.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-sm">{fechaLocal(f.fecha)}</TableCell>
                  <TableCell className="text-sm font-medium text-foreground">{f.loteadora}</TableCell>
                  <TableCell className="text-sm">{f.usuario ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono">{f.articuloId}</span>
                    {f.articuloDesc && <span className="block max-w-56 truncate text-xs text-muted-foreground" title={f.articuloDesc}>{f.articuloDesc}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="block font-mono text-xs text-muted-foreground">{f.plantilla}</span>
                    {f.campos.map((c) => (
                      <span key={c.fieldId} className="block font-mono text-sm font-semibold whitespace-pre text-foreground" title={`Campo ${c.fieldId}`}>{c.texto}</span>
                    ))}
                    {resumenDatos(f.datos) && <span className="mt-0.5 block text-xs text-muted-foreground">{resumenDatos(f.datos)}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge className={RESULTADO[f.resultado].className}>{RESULTADO[f.resultado].label}</Badge>
                    {f.mensaje && <span className="mt-1 block max-w-56 text-xs text-muted-foreground">{f.mensaje}</span>}
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
