import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { permisosDeRol, requireAdmin } from '@/lib/permissions';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const db = getDb();
  const roles = db.prepare('SELECT id, name, label, created_at FROM roles ORDER BY id').all() as { name: string }[];
  // Permisos de configuración concedidos a cada rol (el admin los tiene todos sin filas)
  return NextResponse.json(roles.map((r) => ({ ...r, permisos: permisosDeRol(r.name) })));
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { name, label } = await req.json();

  if (!name || !label) {
    return NextResponse.json({ error: 'name y label son obligatorios' }, { status: 400 });
  }

  const cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanLabel = String(label).trim();

  if (!cleanName) {
    return NextResponse.json({ error: 'Nombre de rol inválido' }, { status: 400 });
  }

  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO roles (name, label) VALUES (?, ?)').run(cleanName, cleanLabel);
    const created = db.prepare('SELECT id, name, label, created_at FROM roles WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'El nombre de rol ya existe' }, { status: 409 });
  }
}
