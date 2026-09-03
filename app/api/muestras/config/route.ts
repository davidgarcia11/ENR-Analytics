// Configuración de /muestras: qué artículos aparecen en el panel. Lista GLOBAL
// compartida (no por usuario — petición explícita: "no se le asigna a un usuario los
// artículos, el admin y un usuario responsable pueden elegir los artículos... y
// siempre se verán esos"), editable por admin y por cualquier usuario con
// users.can_configure_muestras = 1 (permiso suelto, asignable a un usuario concreto
// desde /admin — ver app/api/admin/users/[id]/muestras-config/route.ts).
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDb } from '@/lib/sqlite';
import { getArticleAllowlist, requireMuestrasConfigAccess, runFullSync } from '@/lib/muestras';

export async function GET(req: NextRequest) {
  const denied = await requireMuestrasConfigAccess();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const allowlist = getArticleAllowlist();

  if (!q) {
    return NextResponse.json({ allowlist, results: [] });
  }

  // Búsqueda de artículos tipo "12" (Producto terminado) por código o descripción,
  // para elegir cuáles añadir a la lista — mismo filtro F4101.IMSRP1='12' que /api/muestras.
  let conn;
  try {
    conn = await getDbConnection();
    const sql = `
      SELECT TRIM(IMLITM) AS ARTICULO, TRIM(IMDSC1) AS DESCRIPCION
      FROM F4101
      WHERE TRIM(IMSRP1) = '12'
        AND (UPPER(TRIM(IMLITM)) LIKE UPPER(:q) OR UPPER(TRIM(IMDSC1)) LIKE UPPER(:q))
        AND ROWNUM <= 30
      ORDER BY IMLITM
    `;
    const result = await conn.execute(sql, { q: `%${q}%` });
    const results = (result.rows as { ARTICULO: string; DESCRIPCION: string }[]).map((r) => ({ articulo: r.ARTICULO, descripcion: r.DESCRIPCION }));
    return NextResponse.json({ allowlist, results });
  } catch (error) {
    console.error('Error en GET /api/muestras/config:', error);
    return NextResponse.json({ error: 'Error al buscar artículos' }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireMuestrasConfigAccess();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const articulo = typeof body?.articulo === 'string' ? body.articulo.trim() : '';
  const descripcion = typeof body?.descripcion === 'string' ? body.descripcion.trim().slice(0, 200) : '';
  if (!articulo || articulo.length > 20) {
    return NextResponse.json({ error: 'Artículo inválido' }, { status: 400 });
  }

  const db = getDb();
  db.prepare('INSERT INTO sample_article_filter (articulo, descripcion) VALUES (?, ?) ON CONFLICT(articulo) DO UPDATE SET descripcion = excluded.descripcion').run(articulo, descripcion);

  // Resincroniza al momento (todo el histórico de la lista ya actualizada) — con el
  // filtro por artículo esto tarda segundos, así que no hace falta esperar al repaso
  // de 30 min para ver el artículo recién añadido en /muestras.
  const sync = await runFullSync();
  return NextResponse.json({ ok: true, sync });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireMuestrasConfigAccess();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const articulo = (searchParams.get('articulo') || '').trim();
  if (!articulo) {
    return NextResponse.json({ error: 'Artículo requerido' }, { status: 400 });
  }

  const db = getDb();
  db.prepare('DELETE FROM sample_article_filter WHERE articulo = ?').run(articulo);
  return NextResponse.json({ ok: true });
}
