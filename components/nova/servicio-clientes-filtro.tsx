// Filtro de clientes de /servicio: búsqueda y selección múltiple sobre los clientes de los envíos ya
// cargados (SDAN8). Los presets («clientes de siempre») son los comunes de Nova (components/nova/presets.tsx).
// Ver docs/servicio.md § 17.
"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Users, X } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

export interface OpcionCliente { id: number; nombre: string }

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function ServicioClientesFiltro({ opciones, value, onChange }: {
  opciones: OpcionCliente[];
  value: number[];
  onChange: (clientes: number[]) => void;
}) {
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return q ? opciones.filter((o) => sinTildes(o.nombre).includes(q)) : opciones;
  }, [opciones, busqueda]);

  const alternar = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const etiqueta =
    value.length === 0 ? "Todos los clientes"
    : value.length === 1 ? (opciones.find((o) => o.id === value[0])?.nombre ?? "1 cliente")
    : `${value.length} clientes`;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 font-normal">
              <Users size={14} className="text-muted-foreground" />
              <span className="max-w-48 truncate">{etiqueta}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-80 gap-3">
          <Input placeholder="Buscar cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div className="max-h-64 overflow-y-auto">
            {visibles.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Sin clientes</p>
            ) : visibles.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={value.includes(o.id)} onCheckedChange={() => alternar(o.id)} />
                <span className="truncate">{o.nombre || `Cliente ${o.id}`}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange([])} title="Quitar el filtro de clientes">
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
