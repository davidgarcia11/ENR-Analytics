import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/permissions';

// GET /api/admin/integracion/openapi[?descargar=1] — la especificación OpenAPI de la
// API de integración (docs/integracion-golive.openapi.yaml), tal cual está en el código
// desplegado: la lee el visor de /admin → Integración › Documentación de la API y se
// descarga para importarla en Apidog o Postman. Permiso "Integración: ver".
export async function GET(req: NextRequest) {
  const acceso = await requireAccess({ permiso: 'admin.integracion.ver' });
  if (!acceso.ok) return acceso.denied;
  try {
    const yaml = await readFile(path.join(process.cwd(), 'docs', 'integracion-golive.openapi.yaml'), 'utf-8');
    const descargar = req.nextUrl.searchParams.get('descargar') === '1';
    return new NextResponse(yaml, {
      headers: {
        'Content-Type': 'application/yaml; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(descargar ? { 'Content-Disposition': 'attachment; filename="integracion-golive.openapi.yaml"' } : {}),
      },
    });
  } catch (err) {
    console.error('Error leyendo la especificación OpenAPI:', err);
    return NextResponse.json({ error: 'No se encuentra la especificación OpenAPI en el servidor' }, { status: 500 });
  }
}
