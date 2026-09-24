import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

// Zonas de las loteadoras (/admin → Zonas), con los roles y usuarios que ven cada
// una. Solo admin. Reglas de visibilidad en lib/loteadora-zonas.ts.

export interface ZonaInput { nombre: string; roles: number[]; usuarios: number[] }

// Valida el body de alta/edición. Roles y usuarios deben existir.
export function parseZonaInput(db: Database.Database, body: any): { error: string } | { value: ZonaInput } {
  const nombre = String(body?.nombre ?? '').trim();
  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (nombre.length > 50) return { error: 'El nombre no puede pasar de 50 caracteres' };
  const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number))] : []);
  const roles = ids(body?.roles);
  const usuarios = ids(body?.usuarios);
  const existe = (tabla: string, id: number) => Number.isInteger(id) && db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id);
  if (roles.some((id) => !existe('roles', id))) return { error: 'Algún rol no existe' };
  if (usuarios.some((id) => !existe('users', id))) return { error: 'Algún usuario no existe' };
  return { value: { nombre, roles, usuarios } };
}

// Sustituye los roles y usuarios asignados a una zona.
export function guardarAsignaciones(db: Database.Database, zonaId: number, z: ZonaInput) {
  db.prepare('DELETE FROM role_zonas WHERE zona_id = ?').run(zonaId);
  db.prepare('DELETE FROM user_zonas WHERE zona_id = ?').run(zonaId);
  const rol = db.prepare('INSERT INTO role_zonas (role_id, zona_id) VALUES (?, ?)');
  const usu = db.prepare('INSERT INTO user_zonas (user_id, zona_id) VALUES (?, ?)');
  for (const id of z.roles) rol.run(id, zonaId);
  for (const id of z.usuarios) usu.run(id, zonaId);
}

export async function GET() {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const zonas = db.prepare(
    `SELECT z.id, z.nombre, (SELECT COUNT(*) FROM loteadoras l WHERE l.zona_id = z.id) AS loteadoras
     FROM zonas z ORDER BY z.nombre`
  ).all() as { id: number }[];
  const roles = db.prepare('SELECT zona_id, role_id FROM role_zonas').all() as { zona_id: number; role_id: number }[];
  const usuarios = db.prepare('SELECT zona_id, user_id FROM user_zonas').all() as { zona_id: number; user_id: number }[];
  return NextResponse.json(zonas.map((z) => ({
    ...z,
    roles: roles.filter((r) => r.zona_id === z.id).map((r) => r.role_id),
    usuarios: usuarios.filter((u) => u.zona_id === z.id).map((u) => u.user_id),
  })));
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const parsed = parseZonaInput(db, await req.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (db.prepare('SELECT 1 FROM zonas WHERE nombre = ?').get(parsed.value.nombre)) {
    return NextResponse.json({ error: 'Ya existe una zona con ese nombre' }, { status: 409 });
  }
  const id = db.transaction(() => {
    const zonaId = Number(db.prepare('INSERT INTO zonas (nombre) VALUES (?)').run(parsed.value.nombre).lastInsertRowid);
    guardarAsignaciones(db, zonaId, parsed.value);
    return zonaId;
  })();
  return NextResponse.json({ id }, { status: 201 });
}
