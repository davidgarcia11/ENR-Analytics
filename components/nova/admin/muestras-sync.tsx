"use client";

// /admin → Muestras → Sincronización, sobre Nova. /muestras nunca consulta Oracle en
// directo: lee de sample_candidates (SQLite), que se sincroniza sola al cambiar la
// lista de artículos visibles y cada 30 min de fondo. Este botón solo fuerza esa
// misma sincronización ya — ver docs/muestras.md. Mismas rutas que antes.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Badge } from "@/components/nova/ui/badge";
import { Alert, AlertDescription } from "@/components/nova/ui/alert";
import { CabeceraSeccion, type SeccionProps } from "./comun";

interface EstadoSync {
  lastSyncedAt: string | null;
  candidatosSincronizados: number;
  error: string | null;
  articulosConfigurados: number;
}

function Dato({ titulo, valor }: { titulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{valor}</p>
    </div>
  );
}

export default function AdminMuestrasSync({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [estado, setEstado] = useState<EstadoSync | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/muestras-sync");
      if (res.ok) setEstado(await res.json());
    } catch { /* silencioso: se ve como "cargando" */ }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // La petición termina cuando termina de verdad la sincronización (sin polling)
  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const res = await apiFetch("/api/admin/muestras-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al sincronizar"); return; }
      toast.success(`Sincronizado — ${data.rows} lotes traídos`);
      cargar();
    } catch { toast.error("Error al sincronizar"); } finally { setSincronizando(false); }
  };

  const sinArticulos = estado?.articulosConfigurados === 0;

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        {estado && !sinArticulos && (
          <Badge
            variant={estado.error ? "destructive" : "secondary"}
            className={!estado.error && estado.lastSyncedAt ? "bg-emerald-400/10 text-emerald-600" : undefined}
          >
            {estado.error ? "Error" : estado.lastSyncedAt ? "Al día" : "Sin sincronizar"}
          </Badge>
        )}
        <Button onClick={sincronizar} disabled={sincronizando || !estado || sinArticulos}>
          {sincronizando ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Sincronizar ahora
        </Button>
      </CabeceraSeccion>
      <div className="space-y-4">
        {!estado ? (
          <div className="flex h-24 items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : sinArticulos ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay artículos configurados: añade al menos uno en &quot;Artículos visibles&quot; dentro de /muestras para que haya algo que sincronizar.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Dato titulo="Artículos configurados" valor={estado.articulosConfigurados.toLocaleString("es-ES")} />
              <Dato titulo="Lotes en caché" valor={estado.candidatosSincronizados.toLocaleString("es-ES")} />
              <Dato
                titulo="Última sincronización"
                valor={estado.lastSyncedAt ? new Date(estado.lastSyncedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—"}
              />
            </div>
            {estado.error && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{estado.error}</AlertDescription>
              </Alert>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          La caché se sincroniza sola al cambiar los artículos visibles de /muestras y cada 30 minutos; el botón solo la adelanta.
        </p>
      </div>
    </>
  );
}
