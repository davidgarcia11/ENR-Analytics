import { NextResponse } from 'next/server'
import { getDbConnection } from '@/lib/db'

// Devuelve los artículos utilizables en la loteadora, con su código,
// descripción y días de caducidad (IMSLD). Ya no se filtra por marca: se
// busca directamente en toda la F4101 (IMSRP1='12', IMSRP6='Y' y IMSTKT
// distinto de 'O'/'U').
export async function GET() {
  let conn
  try {
    conn = await getDbConnection()
    const result = await conn.execute(
      `SELECT TRIM(IMLITM) AS id, TRIM(IMDSC1) AS descripcion, NVL(IMSLD, 0) AS diasCaducidad
       FROM F4101
       WHERE TRIM(IMSRP1) = '12'
         AND TRIM(IMSRP6) = 'Y'
         AND TRIM(IMSTKT) NOT IN ('O', 'U')
         AND TRIM(IMLITM) IS NOT NULL
       ORDER BY TRIM(IMDSC1)`
    )
    const rows = (result.rows as any[])
      .map(r => ({
        id: String(r.ID || '').trim(),
        descripcion: String(r.DESCRIPCION || '').trim(),
        diasCaducidad: Number(r.DIASCADUCIDAD ?? 0),
      }))
      .filter(r => r.id)
    return NextResponse.json(rows)
  } catch (err: any) {
    console.error('Loteadora/articulos error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) try { await conn.close() } catch (e) { console.error(e) }
  }
}
