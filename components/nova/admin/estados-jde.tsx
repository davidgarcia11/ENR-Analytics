"use client";

// /admin → Estados JDE, sobre Nova: descripciones editables de los códigos SYEDSP
// (F47011) que se muestran en /comparativa-seres (tooltip del badge de estado,
// columna "Descripción" y exportación a Excel). Mismas rutas que la versión anterior.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface JdeStatus {
  code: string;
  description: string;
}

export default function AdminEstadosJde({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [estados, setEstados] = useState<JdeStatus[]>([]);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/jde-statuses");
      if (res.ok) {
        const data: JdeStatus[] = await res.json();
        setEstados(data);
        setBorradores(Object.fromEntries(data.map((s) => [s.code, s.description])));
      }
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const guardar = async (code: string) => {
    const description = (borradores[code] ?? "").trim();
    if (!description) { toast.error(`La descripción de ${code} no puede estar vacía`); return; }
    setGuardando(code);
    try {
      const res = await apiFetch(`/api/admin/jde-statuses/${encodeURIComponent(code)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al guardar"); return; }
      toast.success(`Descripción de "${code}" guardada`);
      cargar();
    } catch { toast.error("Error de conexión"); } finally { setGuardando(null); }
  };

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />
      <TablaCard
        toolbar={
          <span className="text-sm text-muted-foreground">
            Códigos <code className="font-mono text-xs">F47011.SYEDSP</code>. Se ven en el tooltip del estado, la columna &quot;Descripción&quot; y el Excel.
          </span>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-24"><span className="sr-only">Guardar</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || estados.length === 0 ? (
              <FilaVacia colSpan={3} cargando={cargando} texto="No hay estados" />
            ) : (
              estados.map((s) => {
                const cambiado = (borradores[s.code] ?? "").trim() !== s.description;
                return (
                  <TableRow key={s.code}>
                    <TableCell>
                      <span className="inline-flex size-8 items-center justify-center rounded-md bg-muted font-mono text-sm font-semibold text-foreground">{s.code}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={borradores[s.code] ?? ""}
                        onChange={(e) => setBorradores((d) => ({ ...d, [s.code]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && cambiado && guardar(s.code)}
                        aria-label={`Descripción del estado ${s.code}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={cambiado ? "default" : "outline"} disabled={!cambiado || guardando === s.code} onClick={() => guardar(s.code)}>
                        {guardando === s.code && <Loader2 className="animate-spin" />}
                        Guardar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TablaCard>
    </>
  );
}
