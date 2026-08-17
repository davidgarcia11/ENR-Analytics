import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDb } from '@/lib/sqlite';

// Lista paginada de confirmaciones del pop-up de /consulta-stock-pda (§8.2 de su doc):
// quién aceptó qué aviso, con qué SSCC/artículo y cuándo. Solo admin.
export async function GET(req: NextRequest) {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = 50;
  const offset = (page - 1) * limit;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const username = searchParams.get('username');
  const estado = searchParams.get('estado');
  const sscc = searchParams.get('sscc');

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (startDate) { where += ' AND created_at >= ?'; params.push(startDate); }
  if (endDate) { where += ' AND created_at < datetime(?, "+1 day")'; params.push(endDate); }
  if (username) { where += ' AND username = ?'; params.push(username); }
  if (estado) { where += ' AND estado = ?'; params.push(estado); }
  if (sscc) { where += ' AND sscc LIKE ?'; params.push(`%${sscc}%`); }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM stock_scan_confirmations ${where}`).get(...params) as any;
  const total = countRow.total;

  const confirmations = db.prepare(
    `SELECT id, user_id, username, sscc, articulo, estado, mensajes, created_at
     FROM stock_scan_confirmations ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const usernames = db.prepare('SELECT DISTINCT username FROM stock_scan_confirmations ORDER BY username').all() as { username: string }[];

  return NextResponse.json({
    confirmations,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    usernames: usernames.map(u => u.username),
  });
}
