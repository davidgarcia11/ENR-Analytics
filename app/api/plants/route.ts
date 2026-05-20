import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { requireScreenAccess } from '@/lib/permissions';

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('pedidos')
  if (denied) return denied
  let conn;
  try {
    conn = await getDbConnection();

    const sql = `
      SELECT TRIM(MCMCU) AS PLANT_CODE, TRIM(MCDL01) AS PLANT_NAME
      FROM F0006
      WHERE MCSTYL = 'BP'
      ORDER BY MCMCU
    `;

    const result = await conn.execute(sql);
    const rows = (result.rows as any[]).map(r => ({
      id: String(r.PLANT_CODE || '').trim(),
      description: String(r.PLANT_NAME || '').trim(),
    })).filter(r => r.id);

    return NextResponse.json(rows);

  } catch (err: any) {
    console.error('Plants Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error(e); }
    }
  }
}
