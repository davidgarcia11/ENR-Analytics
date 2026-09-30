import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';
import { exportarCopia, importarCopia } from '@/lib/loteadora-plantilla';

// Exportar / importar SOLO las asociaciones artículo → plantilla (sección
// Artículos de /admin). La abre el mismo permiso que el resto de esa sección
// (ver o asociar artículos), por eso nunca crea ni toca plantillas: las del
// archivo se ignoran y cada artículo debe apuntar a una que ya exista aquí.
// La copia completa (plantillas + asociaciones) es /api/admin/loteadora-copia, solo admin.
export async function GET() {
  const acceso = await requireAccess({ permiso: L('articulos') });
  if (!acceso.ok) return acceso.denied;
  return NextResponse.json({ ...exportarCopia(getDb()), plantillas: [] });
}

// Body: { copia, sustituir? }
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ permiso: L('articulos', 'editar') });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json().catch(() => null);
  const copia = body?.copia && typeof body.copia === 'object' ? { ...body.copia, plantillas: [] } : body?.copia;
  const resultado = importarCopia(getDb(), copia, body?.sustituir === true);
  if ('error' in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado.value);
}
