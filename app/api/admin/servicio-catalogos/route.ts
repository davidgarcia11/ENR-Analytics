// /admin → Listas de servicio: motivos, responsables y transportistas de los desplegables de
// /servicio. Con el permiso admin.servicio.catalogos (lib/permisos.ts; el admin lo tiene
// siempre). Quitar una opción que ya está en incidencias guardadas la DESACTIVA (deja de
// salir en los desplegables pero las incidencias antiguas la conservan); solo se borra del
// todo si nunca se usó. Ver docs/servicio.md.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { listarCatalogo } from '@/lib/servicio-catalogo';
import { TIPOS_CATALOGO, limpiarNombreCatalogo, type TipoCatalogo } from '@/lib/servicio';

const PERMISO = 'admin.servicio.catalogos' as const;
const esTipo = (v: unknown): v is TipoCatalogo => (TIPOS_CATALOGO as readonly unknown[]).includes(v);

export async function GET() {
  const acceso = await requireAccess({ permiso: PERMISO });
  if (!acceso.ok) return acceso.denied;
  return NextResponse.json({ items: listarCatalogo() });
}

// Alta. Si el nombre ya existe pero estaba desactivado, se reactiva.
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ permiso: PERMISO });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json().catch(() => null);
  const nombre = limpiarNombreCatalogo(body?.nombre);
  if (!esTipo(body?.tipo)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
  if (!nombre) return NextResponse.json({ error: 'El nombre es obligatorio (máximo 40 caracteres)' }, { status: 400 });

  const db = getDb();
  const existente = db.prepare('SELECT activo FROM servicio_catalogo WHERE tipo = ? AND nombre = ?').get(body.tipo, nombre) as { activo: number } | undefined;
  if (existente?.activo) return NextResponse.json({ error: 'Ya existe' }, { status: 409 });
  if (existente) {
    db.prepare('UPDATE servicio_catalogo SET activo = 1 WHERE tipo = ? AND nombre = ?').run(body.tipo, nombre);
  } else {
    const orden = (db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM servicio_catalogo WHERE tipo = ?').get(body.tipo) as { o: number }).o;
    db.prepare('INSERT INTO servicio_catalogo (tipo, nombre, orden) VALUES (?, ?, ?)').run(body.tipo, nombre, orden);
  }
  return NextResponse.json({ ok: true });
}

// Activar / desactivar una opción
export async function PATCH(req: NextRequest) {
  const acceso = await requireAccess({ permiso: PERMISO });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json().catch(() => null);
  const nombre = limpiarNombreCatalogo(body?.nombre);
  if (!esTipo(body?.tipo) || !nombre || typeof body?.activo !== 'boolean') {
    return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  }
  const r = getDb().prepare('UPDATE servicio_catalogo SET activo = ? WHERE tipo = ? AND nombre = ?').run(body.activo ? 1 : 0, body.tipo, nombre);
  if (r.changes === 0) return NextResponse.json({ error: 'No existe' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Borrado definitivo: solo si ninguna incidencia guardada lo usa
export async function DELETE(req: NextRequest) {
  const acceso = await requireAccess({ permiso: PERMISO });
  if (!acceso.ok) return acceso.denied;

  const { searchParams } = new URL(req.url);
  const tipo = searchParams.get('tipo');
  const nombre = limpiarNombreCatalogo(searchParams.get('nombre'));
  if (!esTipo(tipo) || !nombre) return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });

  const item = listarCatalogo().find((i) => i.tipo === tipo && i.nombre === nombre);
  if (!item) return NextResponse.json({ error: 'No existe' }, { status: 404 });
  if (item.usos > 0) {
    return NextResponse.json({ error: `Está en uso en ${item.usos} envío${item.usos === 1 ? '' : 's'}: desactívala en vez de borrarla` }, { status: 409 });
  }
  getDb().prepare('DELETE FROM servicio_catalogo WHERE tipo = ? AND nombre = ?').run(tipo, nombre);
  return NextResponse.json({ ok: true });
}
