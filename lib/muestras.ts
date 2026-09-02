// Helpers compartidos entre app/api/muestras/route.ts y app/api/muestras/config/route.ts.
// Viven aquí (no exportados desde un route.ts) porque Next.js solo permite exportar
// los nombres reservados (GET/POST/...) desde un archivo route.ts.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

// Lista global de artículos visibles en /muestras (si está vacía, se ven todos).
export function getArticleAllowlist(): { articulo: string; descripcion: string }[] {
  const db = getDb();
  return db.prepare('SELECT articulo, descripcion FROM sample_article_filter ORDER BY articulo').all() as { articulo: string; descripcion: string }[];
}

// Acceso a la configuración de artículos: admin, o cualquier usuario con
// users.can_configure_muestras = 1 (permiso suelto asignado por admin desde /admin).
export async function requireMuestrasConfigAccess(): Promise<NextResponse | null> {
  const session = await verifySession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.role === 'admin') return null;
  const db = getDb();
  const row = db.prepare('SELECT can_configure_muestras FROM users WHERE id = ?').get(session.id) as { can_configure_muestras: number } | undefined;
  if (!row?.can_configure_muestras) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  return null;
}
