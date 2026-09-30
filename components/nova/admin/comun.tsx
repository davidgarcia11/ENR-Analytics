"use client";

// Piezas compartidas por las secciones de /admin (components/nova/admin/*).
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Search, Upload } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Input } from "@/components/nova/ui/input";
import { Button } from "@/components/nova/ui/button";
import { TableCell, TableRow } from "@/components/nova/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/nova/ui/dialog";

/** Confirmación de una acción destructiva (borrar/quitar). */
export function ConfirmarDialog({ open, onOpenChange, title, description, confirmLabel = "Eliminar", onConfirm, pending }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Fila única de una tabla mientras carga o cuando no hay nada que mostrar. */
export function FilaVacia({ colSpan, cargando, texto = "Sin resultados" }: { colSpan: number; cargando?: boolean; texto?: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
        {cargando ? <Loader2 className="mx-auto size-4 animate-spin" /> : texto}
      </TableCell>
    </TableRow>
  );
}

/** Mensaje de error dentro de un formulario de diálogo. */
export function ErrorForm({ error }: { error: string }) {
  return error ? <p className="text-sm text-destructive">{error}</p> : null;
}

/** Props que recibe cada sección de /admin (título y descripción vienen del sidebar). */
export interface SeccionProps {
  titulo: string;
  descripcion: string;
}

/**
 * Cabecera de sección al estilo de los dashboards de ShadcnSpace: título y
 * descripción a la izquierda, acción principal (children) a la derecha, en la misma
 * línea. Sustituye al título de tarjeta que repetía el de la página.
 */
export function CabeceraSeccion({ titulo, descripcion, children }: SeccionProps & { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * Contenedor de la tabla de una sección: borde redondeado, barra opcional encima
 * (buscador a la izquierda, `extra` a la derecha) y la tabla a ras del borde con el
 * mismo margen lateral que la barra.
 */
export function TablaCard({ toolbar, extra, children }: { toolbar?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {(toolbar || extra) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {extra && <div className="text-sm text-muted-foreground">{extra}</div>}
        </div>
      )}
      <div className="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4 [&_th]:h-10 [&_th]:bg-muted/40">
        {children}
      </div>
    </div>
  );
}

/** Buscador de la barra de una tabla. */
export function Buscador({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 pl-8" />
    </div>
  );
}

/**
 * Botones Exportar / Importar de la copia de la loteadora (JSON), con el diálogo
 * de importación. `ruta` hace GET (exportar) y POST {copia, sustituir} (importar):
 * /api/admin/loteadora-copia (plantillas + asociaciones, solo admin) o
 * /api/admin/loteadora-articulos/copia (solo asociaciones). Reglas en
 * importarCopia (lib/loteadora-plantilla.ts).
 */
export function BotonesCopia({ ruta, archivo, conPlantillas, onImportado, puedeImportar = true }: {
  ruta: string;
  /** Sin permiso para importar, solo se ve Exportar */
  puedeImportar?: boolean;
  /** Prefijo del archivo descargado: `<archivo>-AAAA-MM-DD.json` */
  archivo: string;
  /** La copia lleva plantillas (si no, solo asociaciones de artículos) */
  conPlantillas?: boolean;
  onImportado: () => void;
}) {
  const apiFetch = useApiFetch();
  const archivoRef = useRef<HTMLInputElement>(null);
  const [importacion, setImportacion] = useState<{ copia: any; nombre: string } | null>(null);
  const [sustituir, setSustituir] = useState(false);
  const [importando, setImportando] = useState(false);

  const exportar = async () => {
    try {
      const res = await apiFetch(ruta);
      if (!res.ok) { toast.error("No se pudo exportar"); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${archivo}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Error de conexión"); }
  };

  const elegir = async (f: File | undefined) => {
    if (archivoRef.current) archivoRef.current.value = ""; // permite volver a elegir el mismo
    if (!f) return;
    try {
      const copia = JSON.parse(await f.text());
      if (copia?.version !== 1 || !Array.isArray(copia.plantillas)) throw new Error();
      setSustituir(false);
      setImportacion({ copia, nombre: f.name });
    } catch { toast.error("Ese archivo no es una copia de la loteadora"); }
  };

  const importar = async () => {
    if (!importacion) return;
    setImportando(true);
    try {
      const res = await apiFetch(ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copia: importacion.copia, sustituir }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "No se pudo importar"); return; }
      const { plantillas: p, articulos: a } = data;
      toast.success(
        (conPlantillas ? `Plantillas: ${p.creadas} nuevas, ${p.sustituidas} sustituidas, ${p.omitidas} sin tocar. ` : "") +
        `Artículos: ${a.creadas} nuevos, ${a.sustituidas} cambiados, ${a.omitidas} sin tocar.`,
        { duration: 8000 },
      );
      setImportacion(null);
      onImportado();
    } catch { toast.error("Error de conexión"); } finally { setImportando(false); }
  };

  const nPlantillas = importacion?.copia.plantillas.length ?? 0;
  const nArticulos = importacion?.copia.articulos?.length ?? 0;
  return (
    <>
      <Button variant="outline" onClick={exportar} title={conPlantillas ? "Descarga las plantillas y las asociaciones de artículos en un archivo" : "Descarga las asociaciones de artículos en un archivo"}>
        <Download />
        Exportar
      </Button>
      {puedeImportar && (
        <Button variant="outline" onClick={() => archivoRef.current?.click()} title="Da de alta lo que traiga un archivo exportado">
          <Upload />
          Importar
        </Button>
      )}
      <input ref={archivoRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => elegir(e.target.files?.[0])} />

      <Dialog open={!!importacion} onOpenChange={(o) => !o && setImportacion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{conPlantillas ? "Importar plantillas" : "Importar asociaciones de artículos"}</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{importacion?.nombre}</span> trae{" "}
              {conPlantillas ? `${nPlantillas} plantillas y ${nArticulos}` : nArticulos} asociaciones de artículos.
              {!conPlantillas && " Cada artículo debe apuntar a una plantilla que ya exista aquí (las plantillas del archivo, si las trae, no se importan)."}
              {" "}Si algo del archivo no es válido, no se importa nada.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={sustituir} onCheckedChange={(v) => setSustituir(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium text-foreground">Sustituir las que ya existan</span>
              <span className="block text-muted-foreground">
                {conPlantillas ? "Plantillas con el mismo nombre y artículos asociados a otra plantilla." : "Artículos que ya estén asociados a otra plantilla."}
                {" "}Sin marcar, solo se añade lo que falta.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportacion(null)}>Cancelar</Button>
            <Button onClick={importar} disabled={importando}>
              {importando && <Loader2 className="animate-spin" />}
              Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
