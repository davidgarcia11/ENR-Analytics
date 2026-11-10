// Filtro de selección múltiple de /servicio sobre los envíos ya cargados: clientes (SDAN8) y tipos de
// pedido (SDDCTO). Búsqueda opcional y «Seleccionar todos», que pasa a modo «todos menos»: desmarcar
// una opción la excluye y una opción nueva entra sola (también en un filtro guardado). Los filtros
// guardados son los comunes de Nova (components/nova/presets.tsx). Ver docs/servicio.md § 17.
"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Users, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

export interface OpcionFiltro<K extends string | number = number> { id: K; nombre: string }
export type OpcionCliente = OpcionFiltro<number>;

// Textos del filtro: por defecto, los de clientes
export interface TextosFiltro { todos: string; plural: string; buscar: string; vacio: string; quitar: string }
const TEXTOS_CLIENTES: TextosFiltro = {
  todos: "Todos los clientes", plural: "clientes", buscar: "Buscar cliente…", vacio: "Sin clientes", quitar: "Quitar el filtro de clientes",
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// `value`: opciones marcadas o, con `excluir`, las quitadas. Vacío y sin excluir = sin filtro.
export default function ServicioClientesFiltro<K extends string | number = number>({ opciones, value, excluir, onChange, textos = TEXTOS_CLIENTES, icono: Icono = Users, buscador = true }: {
  opciones: OpcionFiltro<K>[];
  value: K[];
  excluir: boolean;
  onChange: (valores: K[], excluir: boolean) => void;
  textos?: TextosFiltro;
  icono?: LucideIcon;
  buscador?: boolean; // sin buscador para listas cortas (p. ej. los 4 tipos de pedido)
}) {
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return q ? opciones.filter((o) => sinTildes(o.nombre).includes(q)) : opciones;
  }, [opciones, busqueda]);

  const marcado = (id: K) => value.includes(id) !== excluir;
  const alternar = (id: K) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id], excluir);

  // Sin búsqueda marca todos (modo «todos menos»); con búsqueda, solo los mostrados
  const marcarTodos = () => {
    if (!busqueda.trim()) return onChange([], true);
    const ids = visibles.map((o) => o.id);
    onChange(excluir ? value.filter((x) => !ids.includes(x)) : [...new Set([...value, ...ids])], excluir);
  };
  const todosMarcados = visibles.length > 0 && visibles.every((o) => marcado(o.id));

  const nombreDe = (id: K) => opciones.find((o) => o.id === id)?.nombre;
  const etiqueta =
    excluir ? (value.length === 0 ? textos.todos : `Todos menos ${value.length === 1 ? (nombreDe(value[0]) ?? "1") : value.length}`)
    : value.length === 0 ? textos.todos
    : value.length === 1 ? (nombreDe(value[0]) ?? `1 ${textos.plural}`)
    : `${value.length} ${textos.plural}`;
  const hayFiltro = value.length > 0 || excluir;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 font-normal">
              <Icono size={14} className="text-muted-foreground" />
              <span className="max-w-56 truncate">{etiqueta}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 gap-3">
          {buscador && <Input placeholder={textos.buscar} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />}
          <div className="flex items-center justify-between gap-2 text-xs">
            <Button variant="ghost" size="xs" onClick={marcarTodos} disabled={todosMarcados}>
              {busqueda.trim() ? `Marcar los ${visibles.length} mostrados` : "Seleccionar todos"}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onChange([], false)} disabled={!hayFiltro}>Limpiar</Button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visibles.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">{textos.vacio}</p>
            ) : visibles.map((o) => (
              <label key={String(o.id)} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={marcado(o.id)} onCheckedChange={() => alternar(o.id)} />
                <span className="truncate">{o.nombre || String(o.id)}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {hayFiltro && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange([], false)} title={textos.quitar}>
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
