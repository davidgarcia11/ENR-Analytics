import { NextResponse } from 'next/server'
import { getDbConnection } from '@/lib/db'
import { getDb } from '@/lib/sqlite'

// Devuelve los artículos utilizables en la loteadora, con su código,
// descripción y días de caducidad (IMSLD). Ya no se filtra por marca: se
// busca directamente en toda la F4101 (IMSRP1='12', IMSRP6='Y' y IMSTKT
// distinto de 'O'/'U'). A cada artículo, si tiene plantilla asociada
// (loteadora_articulo_mensajes), se le adjunta el nombre de mensaje y los
// IDs de campo (lote/cocida/caducidad) para que /loteadora pueda autocargarla
// sin otra llamada.
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

    const db = getDb()
    const asociaciones = db.prepare(
      `SELECT am.articulo_id, m.name AS messageName, m.lot_field_id AS lotFieldId,
              m.cocida_field_id AS cocidaFieldId, m.expiry_field_id AS expiryFieldId, m.hora_field_id AS horaFieldId,
              m.turno_field_id AS turnoFieldId, m.linea_field_id AS lineaFieldId
       FROM loteadora_articulo_mensajes am
       JOIN loteadora_mensajes m ON m.id = am.mensaje_id`
    ).all() as { articulo_id: string; messageName: string; lotFieldId: number; cocidaFieldId: number; expiryFieldId: number; horaFieldId: number; turnoFieldId: number; lineaFieldId: number }[]
    const plantillaPorArticulo = new Map(asociaciones.map(a => [a.articulo_id, {
      messageName: a.messageName, lotFieldId: a.lotFieldId, cocidaFieldId: a.cocidaFieldId, expiryFieldId: a.expiryFieldId, horaFieldId: a.horaFieldId, turnoFieldId: a.turnoFieldId, lineaFieldId: a.lineaFieldId,
    }]))

    const rowsConPlantilla = rows.map(r => ({ ...r, plantilla: plantillaPorArticulo.get(r.id) ?? null }))

    return NextResponse.json(rowsConPlantilla)
  } catch (err: any) {
    console.error('Loteadora/articulos error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  } finally {
    if (conn) try { await conn.close() } catch (e) { console.error(e) }
  }
}
