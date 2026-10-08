import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/permissions';

// Visor de la documentación de la API de integración (Swagger UI), que se enseña dentro
// de /admin → Integración › Documentación de la API. Permiso "Integración: ver".
//   GET /api/admin/integracion/docs                       → la página del visor
//   GET /api/admin/integracion/docs/<archivo>             → sus archivos (Swagger UI, arranque y estilos)
// Swagger UI va instalado en el proyecto (swagger-ui-dist, versión fija), no se carga de
// una web externa: en una página con sesión no se ejecuta código de terceros de Internet.
// Lee la especificación de /api/admin/integracion/openapi, la del código desplegado.

// Archivos de swagger-ui-dist que se sirven (solo estos: nada de rutas arbitrarias)
const ARCHIVOS: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
};

// Arranque del visor, como archivo aparte (no dentro del HTML) para que la política de
// contenido no tenga que permitir scripts en línea. "Try it out" llama a la API en este
// mismo servidor, sea cual sea el que diga la especificación (por defecto, localhost).
const INICIAR = `SwaggerUIBundle({
  url: '/api/admin/integracion/openapi',
  dom_id: '#api',
  docExpansion: 'list',
  defaultModelsExpandDepth: 0,
  persistAuthorization: false,
  requestInterceptor: function (req) {
    var u = new URL(req.url, location.origin);
    if (u.pathname.indexOf('/api/integracion/') === 0) req.url = location.origin + u.pathname + u.search;
    return req;
  },
});
`;

const PAGINA = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API de integración — Documentación</title>
  <link rel="stylesheet" href="/api/admin/integracion/docs/swagger-ui.css">
  <link rel="stylesheet" href="/api/admin/integracion/docs/visor.css">
</head>
<body>
  <div id="api"></div>
  <script src="/api/admin/integracion/docs/swagger-ui-bundle.js"></script>
  <script src="/api/admin/integracion/docs/iniciar.js"></script>
</body>
</html>`;

const VISOR_CSS = 'body { margin: 0; background: #fff; } .swagger-ui .topbar { display: none; }';

// Cabeceras de seguridad del visor:
// - solo scripts y estilos de este servidor (Swagger UI pone atributos style, de ahí
//   'unsafe-inline' solo en estilos), imágenes propias o en línea (iconos), y
//   peticiones solo a este servidor (la especificación y "Try it out");
// - solo se puede incrustar en el propio dashboard (frame-ancestors 'self');
// - nosniff: cada archivo se interpreta solo como su tipo.
const SEGURIDAD = {
  'Content-Security-Policy': [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "connect-src 'self'", "font-src 'self' data:", "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ archivo?: string[] }> }) {
  const acceso = await requireAccess({ permiso: 'admin.integracion.ver' });
  if (!acceso.ok) return acceso.denied;
  const { archivo } = await params;
  const responder = (cuerpo: string | Buffer, tipo: string, cache = 'no-store') =>
    new NextResponse(cuerpo as BodyInit, { headers: { ...SEGURIDAD, 'Content-Type': tipo, 'Cache-Control': cache } });

  if (!archivo?.length) return responder(PAGINA, 'text/html; charset=utf-8');
  const nombre = archivo.join('/');
  if (nombre === 'iniciar.js') return responder(INICIAR, 'text/javascript; charset=utf-8');
  if (nombre === 'visor.css') return responder(VISOR_CSS, 'text/css; charset=utf-8');
  const tipo = ARCHIVOS[nombre];
  if (!tipo) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  try {
    const contenido = await readFile(path.join(process.cwd(), 'node_modules', 'swagger-ui-dist', nombre));
    return responder(contenido, tipo, 'private, max-age=86400');
  } catch (err) {
    console.error('Error sirviendo Swagger UI:', err);
    return NextResponse.json({ error: 'Visor no instalado (swagger-ui-dist)' }, { status: 500 });
  }
}
