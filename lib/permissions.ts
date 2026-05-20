import { NextResponse } from 'next/server';
import { getDb } from './sqlite';
import { verifySession } from './auth';

export interface ScreenConfig {
  is_public: boolean;
  allowed_roles: string[];
}

export function getAllScreensConfig(): Record<string, ScreenConfig> {
  const db = getDb();
  const screens = db.prepare('SELECT id, key, is_public FROM screens').all() as { id: number; key: string; is_public: number }[];

  const result: Record<string, ScreenConfig> = {};
  for (const screen of screens) {
    const roles = db.prepare(`
      SELECT r.name FROM screen_permissions sp
      JOIN roles r ON r.id = sp.role_id
      WHERE sp.screen_id = ?
    `).all(screen.id) as { name: string }[];

    result[screen.key] = {
      is_public: screen.is_public === 1,
      allowed_roles: roles.map(r => r.name),
    };
  }
  return result;
}

// Devuelve NextResponse 401/403 si no hay acceso, o null si está permitido.
// Regla: canAccess = is_public || role==='admin' || allowed_roles.includes(role)
export async function requireScreenAccess(screenKey: string): Promise<NextResponse | null> {
  const db = getDb();
  const screen = db.prepare('SELECT id, is_public FROM screens WHERE key = ?').get(screenKey) as { id: number; is_public: number } | undefined;

  // Si la pantalla no está registrada, dejar pasar
  if (!screen) return null;
  if (screen.is_public === 1) return null;

  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // admin siempre tiene acceso
  if (session.role === 'admin') return null;

  const hasPermission = db.prepare(`
    SELECT 1 FROM screen_permissions sp
    JOIN roles r ON r.id = sp.role_id
    WHERE sp.screen_id = ? AND r.name = ?
  `).get(screen.id, session.role);

  if (!hasPermission) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  return null;
}
