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
  const source = searchParams.get('source'); // nuevo filtro por panel
  const chartDays = parseInt(searchParams.get('chartDays') || '14'); // días del gráfico

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
  if (source) {
    where += ' AND source = ?';
    params.push(source);
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

  // Tiempos por día para el gráfico (días configurables)
  const dailyStats = db.prepare(
    `SELECT
       DATE(created_at) as day,
       COUNT(*) as queries,
       ROUND(AVG(execution_time_ms)) as avgTime,
       COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id ELSE NULL END) as uniqueUsers
     FROM query_logs
     WHERE filters NOT LIKE '%"action":"login"%'
       AND created_at >= datetime('now', '-' || ? || ' days')
     GROUP BY DATE(created_at)
     ORDER BY day`
  ).all(chartDays) as any[];

  // Ranking de usuarios autenticados (excluye Invitado y logins)
  const topUsers = db.prepare(
    `SELECT username, COUNT(*) as queries
     FROM query_logs
     WHERE username != 'Invitado'
       AND filters NOT LIKE '%"action":"login"%'
     GROUP BY username
     ORDER BY queries DESC
     LIMIT 5`
  ).all() as { username: string; queries: number }[];

  // Total de consultas anónimas
  const invitadoRow = db.prepare(
    `SELECT COUNT(*) as count FROM query_logs WHERE username = 'Invitado' AND filters NOT LIKE '%"action":"login"%'`
  ).get() as any;

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
    topUsers,
    invitadoCount: invitadoRow?.count || 0,
  });
}
