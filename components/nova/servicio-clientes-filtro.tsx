// Filtro de clientes de /servicio: búsqueda y selección múltiple sobre los clientes de los envíos ya
// cargados (SDAN8). «Seleccionar todos» pasa a modo «todos menos»: desmarcar un cliente lo excluye y un
// cliente nuevo entra solo (también en un filtro guardado). Los filtros guardados son los comunes de Nova
// (components/nova/presets.tsx). Ver docs/servicio.md § 17.
"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Users, X } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

export interface OpcionCliente { id: number; nombre: string }

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// `value`: clientes marcados o, con `excluir`, los quitados. Vacío y sin excluir = sin filtro.
export default function ServicioClientesFiltro({ opciones, value, excluir, onChange }: {
  opciones: OpcionCliente[];
  value: number[];
  excluir: boolean;
  onChange: (clientes: number[], excluir: boolean) => void;
}) {
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return q ? opciones.filter((o) => sinTildes(o.nombre).includes(q)) : opciones;
  }, [opciones, busqueda]);

  const marcado = (id: number) => value.includes(id) !== excluir;
  const alternar = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id], excluir);

  // Sin búsqueda marca todos (modo «todos menos»); con búsqueda, solo los mostrados
  const marcarTodos = () => {
    if (!busqueda.trim()) return onChange([], true);
    const ids = visibles.map((o) => o.id);
    onChange(excluir ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])], excluir);
  };
  const todosMarcados = visibles.length > 0 && visibles.every((o) => marcado(o.id));

  const nombreDe = (id: number) => opciones.find((o) => o.id === id)?.nombre;
  const etiqueta =
    excluir ? (value.length === 0 ? "Todos los clientes" : `Todos menos ${value.length === 1 ? (nombreDe(value[0]) ?? "1") : value.length}`)
    : value.length === 0 ? "Todos los clientes"
    : value.length === 1 ? (nombreDe(value[0]) ?? "1 cliente")
    : `${value.length} clientes`;
  const hayFiltro = value.length > 0 || excluir;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 font-normal">
              <Users size={14} className="text-muted-foreground" />
              <span className="max-w-56 truncate">{etiqueta}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 gap-3">
          <Input placeholder="Buscar cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div className="flex items-center justify-between gap-2 text-xs">
            <Button variant="ghost" size="xs" onClick={marcarTodos} disabled={todosMarcados}>
              {busqueda.trim() ? `Marcar los ${visibles.length} mostrados` : "Seleccionar todos"}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onChange([], false)} disabled={!hayFiltro}>Limpiar</Button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visibles.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Sin clientes</p>
            ) : visibles.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={marcado(o.id)} onCheckedChange={() => alternar(o.id)} />
                <span className="truncate">{o.nombre || `Cliente ${o.id}`}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {hayFiltro && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange([], false)} title="Quitar el filtro de clientes">
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
