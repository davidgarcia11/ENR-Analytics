// Filtro de clientes de /servicio, con presets de «clientes de siempre». Los presets usan la misma API que
// el resto de la app (/api/presets, por usuario y panel) pero con interfaz Nova: PresetPanel es del sistema
// viejo. Cada preset guarda { clientes: number[] } (SDAN8); el marcado con la estrella se aplica al abrir el
// panel. En el modo de ejemplo (?mock=1) los presets van a otro panel (`servicio-ejemplo`) para no mezclar
// clientes inventados con los reales. Ver docs/servicio.md.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Star, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Checkbox } from "@/components/nova/ui/checkbox";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";
import { cn } from "@/lib/utils";

export interface OpcionCliente { id: number; nombre: string }

interface Preset { id: number; name: string; filters: string; es_predeterminado: number }

// Un preset mal formado (JSON roto, otro formato) se trata como vacío en vez de romper el panel.
const clientesDe = (p: Preset): number[] => {
  try {
    const c = JSON.parse(p.filters)?.clientes;
    return Array.isArray(c) ? c.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
};

const sinTildes = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function ServicioClientesFiltro({ opciones, value, onChange, esMock }: {
  opciones: OpcionCliente[];
  value: number[];
  onChange: (clientes: number[]) => void;
  esMock: boolean;
}) {
  const SCREEN = esMock ? "servicio-ejemplo" : "servicio";
  const apiFetch = useApiFetch();
  const [busqueda, setBusqueda] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [nombre, setNombre] = useState("");
  // El predeterminado se aplica una sola vez, al terminar la primera carga de presets
  const predeterminadoAplicado = useRef(false);

  const cargarPresets = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/presets?screen=${SCREEN}`);
      if (res.ok) setPresets(await res.json());
    } catch { /* sin presets el filtro sigue funcionando */ }
  }, [apiFetch]);

  useEffect(() => {
    apiFetch(`/api/presets?screen=${SCREEN}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Preset[]) => {
        setPresets(lista);
        const p = lista.find((x) => x.es_predeterminado === 1);
        if (p && !predeterminadoAplicado.current) onChange(clientesDe(p));
        predeterminadoAplicado.current = true;
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SCREEN]);

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return q ? opciones.filter((o) => sinTildes(o.nombre).includes(q)) : opciones;
  }, [opciones, busqueda]);

  const alternar = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  const etiqueta =
    value.length === 0 ? "Todos los clientes"
    : value.length === 1 ? (opciones.find((o) => o.id === value[0])?.nombre ?? "1 cliente")
    : `${value.length} clientes`;

  // Las tres acciones sobre presets recargan la lista al terminar para reflejar lo que quedó en el servidor
  const llamar = async (url: string, init: RequestInit, errorPorDefecto: string) => {
    try {
      const res = await apiFetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? errorPorDefecto);
      await cargarPresets();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : errorPorDefecto);
      return false;
    }
  };

  const guardar = async () => {
    const n = nombre.trim();
    if (!n || value.length === 0) return;
    const ok = await llamar("/api/presets", {
      method: "POST",
      body: JSON.stringify({ name: n, filters: { clientes: value }, screen: SCREEN }),
    }, "No se ha podido guardar el preset");
    if (ok) { setNombre(""); toast.success(`Preset «${n}» guardado`); }
  };

  const marcarPredeterminado = (p: Preset) =>
    llamar(`/api/presets/${p.id}`, { method: "PATCH", body: JSON.stringify({ predeterminado: p.es_predeterminado !== 1 }) }, "No se ha podido cambiar el predeterminado");

  const borrar = (p: Preset) => llamar(`/api/presets/${p.id}`, { method: "DELETE" }, "No se ha podido borrar el preset");

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
          <div className="max-h-56 overflow-y-auto">
            {visibles.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">Sin clientes</p>
            ) : visibles.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                <Checkbox checked={value.includes(o.id)} onCheckedChange={() => alternar(o.id)} />
                <span className="truncate">{o.nombre || `Cliente ${o.id}`}</span>
              </label>
            ))}
          </div>

          <div className="grid gap-2 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Mis presets de clientes</p>
              {presets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no tienes ninguno. Elige clientes y guárdalos aquí abajo.</p>
              ) : (
                <ul className="grid gap-0.5">
                  {presets.map((p) => (
                    <li key={p.id} className="flex items-center gap-1">
                      <button type="button" className="min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm hover:bg-muted" onClick={() => onChange(clientesDe(p))}>
                        {p.name} <span className="text-xs text-muted-foreground">· {clientesDe(p).length}</span>
                      </button>
                      <Button
                        variant="ghost" size="icon-xs"
                        title={p.es_predeterminado === 1 ? "Es el predeterminado (se aplica al abrir). Pulsa para quitarlo" : "Aplicar este preset al abrir el panel"}
                        onClick={() => marcarPredeterminado(p)}
                      >
                        <Star size={14} className={cn(p.es_predeterminado === 1 ? "fill-amber-400 text-amber-500" : "text-muted-foreground")} />
                      </Button>
                      <Button variant="ghost" size="icon-xs" title="Borrar preset" onClick={() => borrar(p)}>
                        <Trash2 size={14} className="text-muted-foreground" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Nombre del preset" value={nombre} maxLength={60}
                  onChange={(e) => setNombre(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
                />
                <Button size="sm" onClick={guardar} disabled={!nombre.trim() || value.length === 0}>Guardar</Button>
              </div>
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
