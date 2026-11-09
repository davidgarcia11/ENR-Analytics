// Presets de los paneles Nova: misma lógica y diseño en todos (botón «Presets» en la barra de filtros).
// Usa la API genérica /api/presets (por usuario y `screen`); el formato y las fechas relativas están en
// lib/presets-nova.ts. PresetPanel (components/PresetPanel.tsx) es el equivalente del sistema viejo.
//
// Uso en un panel (ver components/nova/README.md § «Presets»):
//   const presets = useNovaPresets<Filtros>("compras", (p) => { /* aplicar p (o nada) y hacer la 1.ª carga */ });
//   <NovaPresets presets={presets} actual={{ filtros, fechas: range }} granularidad="mes" onAplicar={aplicar} />
// El predeterminado llega en el callback ANTES de la primera consulta, para no consultar dos veces.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronDown, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { cn } from "@/lib/utils";
import {
  PERIODOS, aplicacionDe, crearContenido, describirFechas, describirRango, leerPreset, modoDe, periodosPara,
  type Aplicacion, type Granularidad, type ModoFechas, type Rango,
} from "@/lib/presets-nova";

interface PresetGuardado { id: number; name: string; filters: string; es_predeterminado: number }

export interface NovaPresetsEstado {
  screen: string | null;
  lista: PresetGuardado[];
  recargar: () => Promise<void>;
}

// `screen` null = todavía no se sabe qué presets cargar (p. ej. hasta leer ?mock=1); no carga nada.
// `onListo` se llama UNA vez, cuando ya se sabe si hay predeterminado (o la carga falló): con él el panel
// aplica el preset y hace su primera consulta.
export function useNovaPresets<F>(screen: string | null, onListo: (predeterminado: Aplicacion<F> | null) => void): NovaPresetsEstado {
  const apiFetch = useApiFetch();
  const [lista, setLista] = useState<PresetGuardado[]>([]);
  const listo = useRef(false);
  const onListoRef = useRef(onListo);
  onListoRef.current = onListo;

  const leer = useCallback(async (): Promise<PresetGuardado[]> => {
    if (!screen) return [];
    try {
      const res = await apiFetch(`/api/presets?screen=${encodeURIComponent(screen)}`);
      return res.ok ? await res.json() : [];
    } catch {
      return []; // sin presets el panel funciona igual
    }
  }, [apiFetch, screen]);

  useEffect(() => {
    if (!screen) return;
    let vivo = true;
    leer().then((l) => {
      if (!vivo) return;
      setLista(l);
      if (listo.current) return;
      listo.current = true;
      const p = l.find((x) => x.es_predeterminado === 1);
      onListoRef.current(p ? aplicacionDe(leerPreset<F>(p.filters)) : null);
    });
    return () => { vivo = false; };
  }, [screen, leer]);

  const recargar = useCallback(async () => { setLista(await leer()); }, [leer]);
  return { screen, lista, recargar };
}

export default function NovaPresets<F extends object>({ presets, actual, granularidad, onAplicar, describir }: {
  presets: NovaPresetsEstado;
  // Filtros actuales del panel (sin las fechas) y el rango actual (null = sin rango, «todas las fechas»)
  actual: { filtros: F; fechas: Rango | null };
  granularidad: Granularidad;
  onAplicar: (a: Aplicacion<F>) => void;
  // Resumen de los filtros de un preset para la lista («3 clientes», «PM · Tortilla»…)
  describir?: (filtros: Partial<F>) => string;
}) {
  const apiFetch = useApiFetch();
  const { screen, lista, recargar } = presets;
  // Un panel sin más filtros que las fechas no puede guardar «sin fechas»: el preset estaría vacío
  const soloFechas = Object.keys(actual.filtros).length === 0;
  const modoInicial: ModoFechas = soloFechas ? (actual.fechas ? "fijas" : periodosPara(granularidad)[0]) : "sin";

  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState<ModoFechas>(modoInicial);
  const [editando, setEditando] = useState<PresetGuardado | null>(null);

  const opcionesFechas = useMemo(() => {
    const o: { value: ModoFechas; label: string }[] = [];
    if (!soloFechas) o.push({ value: "sin", label: "Sin fechas (solo los filtros)" });
    if (actual.fechas) o.push({ value: "fijas", label: `Fechas fijas: ${describirRango(actual.fechas)}` });
    periodosPara(granularidad).forEach((p) => o.push({ value: p, label: PERIODOS[p].label }));
    return o;
  }, [soloFechas, actual.fechas, granularidad]);
  // Si el modo elegido deja de existir (p. ej. «fijas» al quitar el rango), vuelve al primero válido
  const modoValido = opcionesFechas.some((o) => o.value === modo) ? modo : opcionesFechas[0]?.value ?? "sin";

  const cancelarEdicion = () => { setEditando(null); setNombre(""); setModo(modoInicial); };

  const llamar = async (url: string, init: RequestInit, error: string) => {
    try {
      const res = await apiFetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? error);
      await recargar();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : error);
      return false;
    }
  };

  const guardar = async () => {
    const n = nombre.trim();
    if (!n || !screen) return;
    const filters = crearContenido(actual.filtros, modoValido, actual.fechas);
    const ok = editando
      ? await llamar(`/api/presets/${editando.id}`, { method: "PUT", body: JSON.stringify({ name: n, filters }) }, "No se ha podido actualizar el preset")
      : await llamar("/api/presets", { method: "POST", body: JSON.stringify({ name: n, filters, screen }) }, "No se ha podido guardar el preset");
    if (ok) { toast.success(editando ? `Preset «${n}» actualizado` : `Preset «${n}» guardado`); cancelarEdicion(); }
  };

  // Como en el PresetPanel de producción: editar carga el preset en el panel; se cambian los filtros y
  // «Actualizar» guarda los filtros actuales en ese preset.
  const editar = (p: PresetGuardado) => {
    const c = leerPreset<F>(p.filters);
    onAplicar(aplicacionDe(c));
    setEditando(p);
    setNombre(p.name);
    setModo(soloFechas && modoDe(c) === "sin" ? modoInicial : modoDe(c));
  };

  const marcarPredeterminado = (p: PresetGuardado) =>
    llamar(`/api/presets/${p.id}`, { method: "PATCH", body: JSON.stringify({ predeterminado: p.es_predeterminado !== 1 }) }, "No se ha podido cambiar el predeterminado");

  const borrar = async (p: PresetGuardado) => {
    if (await llamar(`/api/presets/${p.id}`, { method: "DELETE" }, "No se ha podido borrar el preset")) {
      if (editando?.id === p.id) cancelarEdicion();
      toast.success(`Preset «${p.name}» borrado`);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <Bookmark size={14} className="text-muted-foreground" />
            <span>Presets</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-96 gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">Mis presets</p>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no tienes ninguno. Ajusta los filtros y guárdalos aquí abajo.</p>
          ) : (
            <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
              {lista.map((p) => {
                const c = leerPreset<F>(p.filters);
                const resumen = [describir?.(c.filtros), describirFechas(c.fechas)].filter(Boolean).join(" · ");
                const predeterminado = p.es_predeterminado === 1;
                return (
                  <li key={p.id} className={cn("flex items-center gap-1 rounded-md", editando?.id === p.id && "bg-muted")}>
                    <button type="button" className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left hover:bg-muted" onClick={() => onAplicar(aplicacionDe(c))}>
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{resumen}</span>
                    </button>
                    <Button variant="ghost" size="icon-xs" title={predeterminado ? "Es el predeterminado: se aplica al abrir el panel. Pulsa para quitarlo" : "Aplicar este preset al abrir el panel"} onClick={() => marcarPredeterminado(p)}>
                      <Star size={14} className={predeterminado ? "fill-amber-400 text-amber-500" : "text-muted-foreground"} />
                    </Button>
                    <Button variant="ghost" size="icon-xs" title="Editar: carga el preset; ajusta los filtros y pulsa «Actualizar»" onClick={() => editar(p)}>
                      <Pencil size={14} className="text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" title="Borrar preset" onClick={() => borrar(p)}>
                      <Trash2 size={14} className="text-muted-foreground" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            {editando ? `Editando «${editando.name}»: se guardan los filtros actuales` : "Guardar los filtros actuales"}
          </p>
          <Input placeholder="Nombre del preset" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guardar(); }} />
          <Select items={opcionesFechas} value={modoValido} onValueChange={(v) => setModo(v as ModoFechas)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {opcionesFechas.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            {editando && <Button size="sm" variant="ghost" onClick={cancelarEdicion}>Cancelar</Button>}
            <Button size="sm" onClick={guardar} disabled={!nombre.trim()}>{editando ? "Actualizar" : "Guardar"}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
