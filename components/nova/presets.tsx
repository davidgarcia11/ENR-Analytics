// Filtros guardados («presets») de los paneles Nova: misma lógica y diseño en todos (botón «Mis filtros»
// en la barra de filtros). En la interfaz se llaman «filtros»; en el código y la API, `presets`.
// Usa la API genérica /api/presets (por usuario y `screen`); el formato y las fechas relativas están en
// lib/presets-nova.ts. PresetPanel (components/PresetPanel.tsx) es el equivalente del sistema viejo.
//
// Uso en un panel (ver components/nova/README.md § «Presets»):
//   const presets = useNovaPresets<Filtros>("compras", (p) => { /* aplicar p (o nada) y hacer la 1.ª carga */ });
//   <NovaPresets presets={presets} actual={{ filtros, fechas: range }} granularidad="mes" onAplicar={aplicar} />
// El predeterminado llega en el callback ANTES de la primera consulta, para no consultar dos veces.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, ChevronDown, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/nova/ui/select";
import { cn } from "@/lib/utils";
import {
  PERIODOS, aplicacionDe, coincide, crearContenido, describirFechas, describirRango, leerPreset, modoDe, periodosPara,
  type Aplicacion, type Granularidad, type ModoFechas, type Rango,
} from "@/lib/presets-nova";

interface PresetGuardado { id: number; name: string; filters: string; es_predeterminado: number }

export interface NovaPresetsEstado {
  screen: string | null;
  lista: PresetGuardado[];
  recargar: () => Promise<PresetGuardado[]>;
  // Id del predeterminado que se aplicó al abrir (para que el botón lo muestre desde el principio)
  aplicadoAlAbrir: number | null;
}

// `screen` null = todavía no se sabe qué presets cargar (p. ej. hasta leer ?mock=1); no carga nada.
// `onListo` se llama UNA vez, cuando ya se sabe si hay predeterminado (o la carga falló): con él el panel
// aplica el preset y hace su primera consulta.
export function useNovaPresets<F>(screen: string | null, onListo: (predeterminado: Aplicacion<F> | null) => void): NovaPresetsEstado {
  const apiFetch = useApiFetch();
  const [lista, setLista] = useState<PresetGuardado[]>([]);
  const [aplicadoAlAbrir, setAplicadoAlAbrir] = useState<number | null>(null);
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
      if (p) setAplicadoAlAbrir(p.id);
      onListoRef.current(p ? aplicacionDe(leerPreset<F>(p.filters)) : null);
    });
    return () => { vivo = false; };
  }, [screen, leer]);

  const recargar = useCallback(async () => {
    const l = await leer();
    setLista(l);
    return l;
  }, [leer]);
  return { screen, lista, recargar, aplicadoAlAbrir };
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
  const { screen, lista, recargar, aplicadoAlAbrir } = presets;
  // Un panel sin más filtros que las fechas no puede guardar «sin fechas»: el preset estaría vacío
  const soloFechas = Object.keys(actual.filtros).length === 0;
  const modoInicial: ModoFechas = soloFechas ? (actual.fechas ? "fijas" : periodosPara(granularidad)[0]) : "sin";

  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState<ModoFechas>(modoInicial);
  const [editando, setEditando] = useState<PresetGuardado | null>(null);
  // Último filtro guardado aplicado (o el predeterminado al abrir): lo muestra el botón
  const [aplicadoId, setAplicadoId] = useState<number | null>(null);
  useEffect(() => { if (aplicadoAlAbrir !== null) setAplicadoId(aplicadoAlAbrir); }, [aplicadoAlAbrir]);

  const aplicado = lista.find((p) => p.id === aplicadoId) ?? null;
  const modificado = aplicado ? !coincide(leerPreset<F>(aplicado.filters), actual) : false;

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

  // Devuelve la lista ya recargada (o null si falló), para poder marcar el filtro recién guardado
  const llamar = async (url: string, init: RequestInit, error: string) => {
    try {
      const res = await apiFetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? error);
      return await recargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : error);
      return null;
    }
  };

  const aplicar = (p: PresetGuardado) => {
    onAplicar(aplicacionDe(leerPreset<F>(p.filters)));
    setAplicadoId(p.id);
  };

  const guardar = async () => {
    const n = nombre.trim();
    if (!n || !screen) return;
    const filters = crearContenido(actual.filtros, modoValido, actual.fechas);
    const l = editando
      ? await llamar(`/api/presets/${editando.id}`, { method: "PUT", body: JSON.stringify({ name: n, filters }) }, "No se ha podido actualizar el filtro")
      : await llamar("/api/presets", { method: "POST", body: JSON.stringify({ name: n, filters, screen }) }, "No se ha podido guardar el filtro");
    if (!l) return;
    // Lo guardado son los filtros actuales: pasa a ser el aplicado
    setAplicadoId(l.find((p) => p.name === n)?.id ?? null);
    toast.success(editando ? `Filtro «${n}» actualizado` : `Filtro «${n}» guardado`);
    cancelarEdicion();
  };

  // Como en el PresetPanel de producción: editar carga el filtro en el panel; se cambian los filtros y
  // «Actualizar» guarda los filtros actuales en él.
  const editar = (p: PresetGuardado) => {
    const c = leerPreset<F>(p.filters);
    aplicar(p);
    setEditando(p);
    setNombre(p.name);
    setModo(soloFechas && modoDe(c) === "sin" ? modoInicial : modoDe(c));
  };

  const marcarPredeterminado = (p: PresetGuardado) =>
    llamar(`/api/presets/${p.id}`, { method: "PATCH", body: JSON.stringify({ predeterminado: p.es_predeterminado !== 1 }) }, "No se ha podido cambiar el predeterminado");

  const borrar = async (p: PresetGuardado) => {
    if (!(await llamar(`/api/presets/${p.id}`, { method: "DELETE" }, "No se ha podido borrar el filtro"))) return;
    if (editando?.id === p.id) cancelarEdicion();
    if (aplicadoId === p.id) setAplicadoId(null);
    toast.success(`Filtro «${p.name}» borrado`);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 font-normal" title={aplicado ? `Filtro guardado aplicado: ${aplicado.name}${modificado ? " (con cambios)" : ""}` : undefined}>
            <Bookmark size={14} className={aplicado ? "fill-current text-foreground" : "text-muted-foreground"} />
            <span className="max-w-48 truncate">{aplicado ? aplicado.name : "Mis filtros"}</span>
            {modificado && <span className="text-xs text-muted-foreground">· modificado</span>}
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-96 gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">Filtros guardados</p>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no tienes ninguno. Ajusta los filtros y guárdalos aquí abajo.</p>
          ) : (
            <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
              {lista.map((p) => {
                const c = leerPreset<F>(p.filters);
                const resumen = [describir?.(c.filtros), describirFechas(c.fechas)].filter(Boolean).join(" · ");
                const predeterminado = p.es_predeterminado === 1;
                const esAplicado = p.id === aplicadoId;
                return (
                  <li key={p.id} className={cn("flex items-center gap-1 rounded-md", editando?.id === p.id && "bg-muted")}>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted" onClick={() => aplicar(p)}>
                      <Check size={14} className={cn("shrink-0", esAplicado ? "text-foreground" : "invisible")} />
                      <span className="min-w-0">
                        <span className={cn("block truncate text-sm", esAplicado && "font-medium")}>
                          {p.name}{esAplicado && modificado && <span className="font-normal text-muted-foreground"> · modificado</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{resumen}</span>
                      </span>
                    </button>
                    <Button variant="ghost" size="icon-xs" title={predeterminado ? "Es el predeterminado: se aplica al abrir el panel. Pulsa para quitarlo" : "Aplicar este filtro al abrir el panel"} onClick={() => marcarPredeterminado(p)}>
                      <Star size={14} className={predeterminado ? "fill-amber-400 text-amber-500" : "text-muted-foreground"} />
                    </Button>
                    <Button variant="ghost" size="icon-xs" title="Editar: carga el filtro; ajusta lo que quieras y pulsa «Actualizar»" onClick={() => editar(p)}>
                      <Pencil size={14} className="text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" title="Borrar filtro" onClick={() => borrar(p)}>
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
          <Input placeholder="Nombre del filtro" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guardar(); }} />
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
