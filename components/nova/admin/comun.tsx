"use client";

// Piezas compartidas por las secciones de /admin (components/nova/admin/*).
import { Loader2, Search } from "lucide-react";
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
