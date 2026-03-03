import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getDb } from '@/lib/sqlite';

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

  const db = getDb();

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (startDate) {
    where += ' AND created_at >= ?';
    params.push(startDate);
  }
  if (endDate) {
    where += ' AND created_at < datetime(?, "+1 day")';
    params.push(endDate);
  }
  if (username) {
    where += ' AND username = ?';
    params.push(username);
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM query_logs ${where}`).get(...params) as any;
  const total = countRow.total;

  const logs = db.prepare(
    `SELECT id, user_id, username, source, filters, result_count, execution_time_ms, created_at
     FROM query_logs ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  // Obtener lista de usernames únicos para el filtro
  const usernames = db.prepare('SELECT DISTINCT username FROM query_logs ORDER BY username').all() as { username: string }[];

  // Estadísticas de consultas (solo las que NO son login)
  const queryWhere = where + " AND filters NOT LIKE '%\"action\":\"login\"%'";
  const stats = db.prepare(
    `SELECT
       COUNT(*) as totalQueries,
       ROUND(AVG(execution_time_ms)) as avgTime,
       MAX(execution_time_ms) as maxTime,
       MIN(execution_time_ms) as minTime,
       ROUND(AVG(result_count)) as avgResults
     FROM query_logs ${queryWhere}`
  ).get(...params) as any;

  // Tiempos por día (últimos 14 días) para el gráfico
  const dailyStats = db.prepare(
    `SELECT
       DATE(created_at) as day,
       COUNT(*) as queries,
       ROUND(AVG(execution_time_ms)) as avgTime,
       COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id ELSE NULL END) as uniqueUsers
     FROM query_logs
     WHERE filters NOT LIKE '%"action":"login"%'
       AND created_at >= datetime('now', '-14 days')
     GROUP BY DATE(created_at)
     ORDER BY day`
  ).all() as any[];

  return NextResponse.json({
    logs,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    usernames: usernames.map(u => u.username),
    stats: {
      totalQueries: stats?.totalQueries || 0,
      avgTime: stats?.avgTime || 0,
      maxTime: stats?.maxTime || 0,
      minTime: stats?.minTime || 0,
      avgResults: stats?.avgResults || 0,
    },
    dailyStats,
  });
}
