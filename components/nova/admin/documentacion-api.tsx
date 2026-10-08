"use client";

// /admin → Integración › Documentación de la API: la especificación OpenAPI de la API de
// integración (docs/integracion-golive.openapi.yaml) en Swagger UI, leída del código
// desplegado, con "Try it out" contra este servidor y descarga del .yaml para Apidog o
// Postman. Permiso 'admin.integracion.ver'. El visor lo sirve
// app/api/admin/integracion/docs; ver docs/integracion-golive.md.
import { Download, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/nova/ui/button";
import { CabeceraSeccion, type SeccionProps } from "./comun";

const VISOR = "/api/admin/integracion/docs";

export default function AdminDocumentacionApi({ titulo, descripcion }: SeccionProps) {
  return (
    <>
      <CabeceraSeccion titulo={titulo} descripcion={descripcion}>
        <div className="flex flex-wrap gap-2">
          {/* Enlaces con aspecto de botón (abren o descargan, no ejecutan nada) */}
          <a href={VISOR} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
            <ExternalLink />
            Abrir en otra pestaña
          </a>
          <a href="/api/admin/integracion/openapi?descargar=1" className={buttonVariants()}>
            <Download />
            Descargar openapi.yaml
          </a>
        </div>
      </CabeceraSeccion>
      <p className="text-sm text-muted-foreground">
        Para probar desde aquí: <span className="font-medium text-foreground">Authorize</span> con una clave de prueba
        (<code className="font-mono">enr_test_…</code>) y luego <span className="font-medium text-foreground">Try it out</span> en
        la petición. Lo enviado se guarda en Mensajes recibidos, marcado como prueba. Para importarlo en Apidog o Postman, descarga el .yaml.
      </p>
      <iframe src={VISOR} title="Documentación de la API de integración" className="h-[75vh] w-full rounded-xl border bg-white" />
    </>
  );
}
