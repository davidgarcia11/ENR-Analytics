"use client";

// /admin → Listas de servicio, sobre Nova: motivos, responsables y transportistas que salen
// en los desplegables del diálogo de edición de /servicio. Quitar una opción ya usada la
// desactiva (las incidencias antiguas la conservan); solo se borra si nunca se usó. Ver
// docs/servicio.md.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useApiFetch } from "@/components/SessionProvider";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Switch } from "@/components/nova/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import { CabeceraSeccion, ConfirmarDialog, FilaVacia, TablaCard, type SeccionProps } from "./comun";
import { TIPOS_CATALOGO, TIPO_CATALOGO_LABEL, type TipoCatalogo } from "@/lib/servicio";
import type { ItemCatalogo } from "@/lib/servicio-catalogo";

const AYUDA: Record<TipoCatalogo, string> = {
  motivo: "Causa de una incidencia en un envío.",
  responsable: "Quién responde de la incidencia.",
  transportista: "Transportistas que salen en el desplegable de cada envío. Si no hay ninguno, el campo queda vacío.",
};

function ListaCatalogo({ tipo, items, cargando, onCambio }: { tipo: TipoCatalogo; items: ItemCatalogo[]; cargando: boolean; onCambio: () => void }) {
  const apiFetch = useApiFetch();
  const [nuevo, setNuevo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aBorrar, setABorrar] = useState<ItemCatalogo | null>(null);

  const llamar = async (metodo: string, url: string, body?: unknown) => {
    const res = await apiFetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(data.error || "No se ha podido guardar"); return false; }
    return true;
  };

  const anadir = async () => {
    if (!nuevo.trim()) return;
    setGuardando(true);
    try {
      if (await llamar("POST", "/api/admin/servicio-catalogos", { tipo, nombre: nuevo })) { setNuevo(""); onCambio(); }
    } finally { setGuardando(false); }
  };

  const cambiarActivo = async (i: ItemCatalogo, activo: boolean) => {
    if (await llamar("PATCH", "/api/admin/servicio-catalogos", { tipo, nombre: i.nombre, activo })) onCambio();
  };

  const borrar = async () => {
    if (!aBorrar) return;
    if (await llamar("DELETE", `/api/admin/servicio-catalogos?tipo=${tipo}&nombre=${encodeURIComponent(aBorrar.nombre)}`)) { setABorrar(null); onCambio(); }
  };

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-base font-medium text-foreground">{TIPO_CATALOGO_LABEL[tipo]}</h2>
        <p className="text-sm text-muted-foreground">{AYUDA[tipo]}</p>
      </div>
      <TablaCard
        toolbar={
          <form className="flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); anadir(); }}>
            <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} maxLength={40} placeholder={`Añadir a ${TIPO_CATALOGO_LABEL[tipo].toLowerCase()}…`} className="h-8" aria-label={`Nuevo valor de ${TIPO_CATALOGO_LABEL[tipo].toLowerCase()}`} />
            <Button type="submit" size="sm" className="gap-1.5" disabled={guardando || !nuevo.trim()}><Plus size={14} /> Añadir</Button>
          </form>
        }
        extra={`${items.filter((i) => i.activo).length} activos de ${items.length}`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-40">Usado en</TableHead>
              <TableHead className="w-24">Activo</TableHead>
              <TableHead className="w-16"><span className="sr-only">Borrar</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando || items.length === 0 ? (
              <FilaVacia colSpan={4} cargando={cargando} texto="Sin valores todavía" />
            ) : (
              items.map((i) => (
                <TableRow key={i.nombre} className={i.activo ? "" : "text-muted-foreground"}>
                  <TableCell className="font-medium">{i.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{i.usos > 0 ? `${i.usos} envío${i.usos === 1 ? "" : "s"}` : "—"}</TableCell>
                  <TableCell><Switch checked={i.activo} onCheckedChange={(v) => cambiarActivo(i, v)} aria-label={`${i.activo ? "Desactivar" : "Activar"} ${i.nombre}`} /></TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i.usos > 0}
                      title={i.usos > 0 ? "En uso: desactívalo en vez de borrarlo" : "Borrar"}
                      onClick={() => setABorrar(i)}
                      aria-label={`Borrar ${i.nombre}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TablaCard>
      <ConfirmarDialog
        open={!!aBorrar}
        onOpenChange={(o) => !o && setABorrar(null)}
        title={`Borrar «${aBorrar?.nombre}»`}
        description="Nunca se ha usado en ningún envío, así que se borra del todo. Si más adelante hiciera falta, se puede volver a añadir."
        onConfirm={borrar}
      />
    </div>
  );
}

export default function AdminServicioCatalogos({ titulo, descripcion }: SeccionProps) {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState<ItemCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    try {
      const res = await apiFetch("/api/admin/servicio-catalogos");
      if (res.ok) setItems((await res.json()).items);
    } finally { setCargando(false); }
  };
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion} />
      {TIPOS_CATALOGO.map((tipo) => (
        <ListaCatalogo key={tipo} tipo={tipo} items={items.filter((i) => i.tipo === tipo)} cargando={cargando} onCambio={cargar} />
      ))}
    </>
  );
}
