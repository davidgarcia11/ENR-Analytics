"use client";

// Panel de configuración de /muestras: qué artículos aparecen en el listado (lista
// global, no por usuario — ver docs/muestras.md). Solo se monta si el usuario tiene
// permiso (admin o can_configure_muestras) — el propio /api/muestras/config vuelve a
// comprobarlo en el servidor, esto es solo para no mostrar el botón a quien no puede
// usarlo.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings, Search, X, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Badge } from "@/components/nova/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/nova/ui/sheet";

interface Articulo { articulo: string; descripcion: string }

export default function MuestrasArticleConfig() {
  const [open, setOpen] = useState(false);
  const [allowlist, setAllowlist] = useState<Articulo[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Articulo[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async (query: string) => {
    setLoading(true);
    try {
      const params = query ? `?q=${encodeURIComponent(query)}` : "";
      const res = await fetch(`/api/muestras/config${params}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setAllowlist(json.allowlist);
      setResults(json.results || []);
    } catch {
      toast.error("No se ha podido cargar la configuración");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(""); }, [open]);

  // Búsqueda con debounce simple — evita una petición a Oracle por cada tecla.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const añadir = async (a: Articulo) => {
    setAllowlist((prev) => (prev.some((x) => x.articulo === a.articulo) ? prev : [...prev, a].sort((x, y) => x.articulo.localeCompare(y.articulo))));
    try {
      const res = await fetch("/api/muestras/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(`No se ha podido añadir ${a.articulo}`);
      load(q);
    }
  };

  const quitar = async (articulo: string) => {
    setAllowlist((prev) => prev.filter((x) => x.articulo !== articulo));
    try {
      const res = await fetch(`/api/muestras/config?articulo=${encodeURIComponent(articulo)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(`No se ha podido quitar ${articulo}`);
      load(q);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Settings size={14} />
            Artículos visibles
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Artículos visibles en Muestras</SheetTitle>
          <SheetDescription>
            Si esta lista está vacía, todo el mundo ve todos los artículos tipo Producto
            terminado. En cuanto añades uno, el panel se restringe a esta lista para
            todos los usuarios (menos admin).
          </SheetDescription>
        </SheetHeader>

        {/* pt-1.5: sin este margen, el anillo de foco del buscador (focus-visible:ring-3)
            queda recortado por arriba por este mismo contenedor con overflow-y-auto. */}
        <div className="flex flex-col gap-3 overflow-y-auto px-4 pt-1.5 pb-4">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar artículo por código o descripción…"
              className="pl-8"
            />
          </div>

          {loading && <Loader2 size={16} className="animate-spin text-muted-foreground self-center" />}

          {q && results.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
              <span className="text-xs text-muted-foreground px-1">Resultados</span>
              {results.map((a) => {
                const yaEsta = allowlist.some((x) => x.articulo === a.articulo);
                return (
                  <div key={a.articulo} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{a.articulo}</p>
                      <p className="text-xs text-muted-foreground truncate">{a.descripcion}</p>
                    </div>
                    <Button size="sm" variant={yaEsta ? "ghost" : "outline"} disabled={yaEsta} onClick={() => añadir(a)} className="shrink-0 gap-1">
                      <Plus size={12} /> {yaEsta ? "Añadido" : "Añadir"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {allowlist.length === 0 ? "Sin restricción — se ven todos los artículos" : `${allowlist.length} artículo${allowlist.length === 1 ? "" : "s"} configurado${allowlist.length === 1 ? "" : "s"}`}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {allowlist.map((a) => (
                <Badge key={a.articulo} variant="secondary" className="gap-1 pr-1">
                  {a.articulo}
                  <button onClick={() => quitar(a.articulo)} className="rounded-full hover:bg-muted-foreground/20 p-0.5" title={`Quitar ${a.articulo}`}>
                    <X size={10} />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
