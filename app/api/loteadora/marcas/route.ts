import { NextResponse } from 'next/server'
import { getDbConnection } from '@/lib/db'

// Devuelve todas las marcas definidas en F0005 (DRSY='41', DRRT='S4').
// Consulta directa a F0005 para evitar problemas de padding CHAR al comparar con F4101.IMSRP4.
export async function GET() {
  let conn
  try {
    conn = await getDbConnection()
    const result = await conn.execute(`
      SELECT TRIM(DRKY) AS id, TRIM(DRDL01) AS descripcion
      FROM prodctl.f0005
      WHERE TRIM(DRSY) = '41'
        AND TRIM(DRRT) = 'S4'
        AND TRIM(DRKY) IS NOT NULL
      ORDER BY TRIM(DRKY)
    `)
    const rows = (result.rows as any[])
      .map(r => ({ id: String(r.ID || '').trim(), descripcion: String(r.DESCRIPCION || r.ID || '').trim() }))
      .filter(r => r.id)
    return NextResponse.json(rows)
  } catch (err: any) {
    console.error('Loteadora/marcas error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) try { await conn.close() } catch (e) { console.error(e) }
  }
}
