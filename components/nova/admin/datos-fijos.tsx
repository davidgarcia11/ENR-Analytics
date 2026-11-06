"use client";

// /admin → Loteadora › Datos fijos: los valores constantes de las plantillas (precio,
// nº de certificado...) en una sola tabla. Los cambia quien tenga el permiso
// de Datos fijos (ver / cambiar valores; por su rol o como extra) sin poder tocar el
// resto de la plantilla (eso es de Plantillas).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useApiFetch, useSession } from "@/components/SessionProvider";
import { tienePermiso, type Permiso } from "@/lib/permisos";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, FilaVacia, TablaCard, type SeccionProps } from "./comun";

interface DatoFijo {
  id: number;
  nombre: string;
  valor: string;
  fieldId: number;
  plantilla: string;
}

export default function AdminDatosFijos({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  // Cada botón según su permiso (lib/permisos.ts); el servidor lo vuelve a comprobar.
  const usuario = useSession().user;
  const puede = (accion: string) => tienePermiso(usuario, `admin.loteadora.datos-fijos.${accion}` as Permiso);
  const [datos, setDatos] = useState<DatoFijo[]>([]);
  const [borradores, setBorradores] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<number | null>(null);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/loteadora-datos-fijos");
      if (res.ok) {
        const data: DatoFijo[] = await res.json();
        setDatos(data);
        setBorradores(Object.fromEntries(data.map((d) => [d.id, d.valor])));
      }
    } finally { setCargando(false); }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const guardar = async (d: DatoFijo) => {
    setGuardando(d.id);
    try {
      const res = await apiFetch(`/api/admin/loteadora-datos-fijos/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: borradores[d.id] ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Error al guardar"); return; }
      toast.success(`${d.nombre} de ${d.plantilla} guardado`);
      // El campo de la máquina mide lo que medía el valor al crear el mensaje (largoPieza):
      // con otro largo, se corta o deja huecos hasta que se vuelva a crear
      const nuevo = borradores[d.id] ?? "";
      if (nuevo.length !== d.valor.length) {
        toast.warning(`El valor ha pasado de ${d.valor.length} a ${nuevo.length} caracteres: vuelve a crear el mensaje ${d.plantilla} en las loteadoras (Plantillas → Crear en la loteadora), o saldrá ${nuevo.length > d.valor.length ? "cortado" : "con huecos"}.`, { duration: 15000 });
      }
      cargar();
    } catch { toast.error("Error de conexión"); } finally { setGuardando(null); }
  };

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />
      <TablaCard
        toolbar={<span className="text-sm text-muted-foreground">Se aplican en el siguiente envío a la loteadora. Solo caracteres ASCII (p. ej. &quot;EUR&quot; en vez de &quot;€&quot;).</span>}
        extra={cargando ? null : `${datos.length} dato${datos.length === 1 ? "" : "s"}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plantilla</TableHead>
              <TableHead>Dato</TableHead>
              <TableHead className="w-20">Campo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead className="w-24"><span className="sr-only">Guardar</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || datos.length === 0 ? (
              <FilaVacia colSpan={5} cargando={cargando} texto="Ninguna plantilla tiene datos fijos (se añaden en Plantillas)" />
            ) : (
              datos.map((d) => {
                const cambiado = (borradores[d.id] ?? "") !== d.valor;
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-sm text-foreground">{d.plantilla}</TableCell>
                    <TableCell className="font-medium text-foreground">{d.nombre}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{d.fieldId}</TableCell>
                    <TableCell>
                      <Input
                        value={borradores[d.id] ?? ""}
                        onChange={(e) => setBorradores((b) => ({ ...b, [d.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && cambiado && guardar(d)}
                        readOnly={!puede("editar")}
                        className="max-w-xs font-mono"
                        aria-label={`${d.nombre} de ${d.plantilla}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {puede("editar") && <Button size="sm" variant={cambiado ? "default" : "outline"} disabled={!cambiado || guardando === d.id} onClick={() => guardar(d)}>
                        {guardando === d.id && <Loader2 className="animate-spin" />}
                        Guardar
                      </Button>}
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
