import { NextRequest, NextResponse } from 'next/server'
import { getDbConnection } from '@/lib/db'

// Devuelve artículos de una marca (IMSRP4) con su código, descripción y días de caducidad (IMSLD).
export async function GET(req: NextRequest) {
  const marca = new URL(req.url).searchParams.get('marca')
  if (!marca) return NextResponse.json({ error: 'Falta parámetro marca' }, { status: 400 })

  let conn
  try {
    conn = await getDbConnection()
    const result = await conn.execute(
      `SELECT TRIM(IMLITM) AS id, TRIM(IMDSC1) AS descripcion, NVL(IMSLD, 0) AS diasCaducidad
       FROM F4101
       WHERE TRIM(IMSRP4) = :marca
         AND TRIM(IMSRP1) = '12'
         AND TRIM(IMLITM) IS NOT NULL
       ORDER BY TRIM(IMDSC1)`,
      { marca }
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
