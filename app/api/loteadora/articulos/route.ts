import { NextResponse } from 'next/server'
import { requireAccess, requireScreenAccess } from '@/lib/permissions'
import { getDbConnection } from '@/lib/db'
import { getDb } from '@/lib/sqlite'
import { leerCampos } from '@/lib/loteadora-plantilla'

// Devuelve los artículos utilizables en la loteadora, con su código,
// descripción y días de caducidad (IMSLD). Ya no se filtra por marca: se
// busca directamente en toda la F4101 (IMSRP1='12', IMSRP6='Y' y IMSTKT
// distinto de 'O'/'U'). A cada artículo, si tiene plantilla asociada
// (loteadora_articulo_mensajes), se le adjunta el nombre de mensaje y sus campos
// con sus piezas (lib/loteadora-plantilla.ts), para que /loteadora pueda
// autocargarla y pintar la vista previa real sin otra llamada.
export async function GET() {
  // También lo usa /admin → Artículos → Plantilla como buscador, así que basta con
  // una de las dos: acceso a la pantalla /loteadora o el permiso de asignar artículos.
  const denied = await requireScreenAccess('loteadora');
  if (denied) {
    const acceso = await requireAccess({ permiso: 'admin.loteadora.articulos' });
    if (!acceso.ok) return denied;
  }

  let conn
  try {
    conn = await getDbConnection()
    const result = await conn.execute(
      // Familia = IMSRP2, con su nombre de la UDC 41/S2 (igual que /api/categories):
      // cada loteadora puede limitar las familias que ofrece (loteadoras.familias).
      `SELECT TRIM(A.IMLITM) AS id, TRIM(A.IMDSC1) AS descripcion, NVL(A.IMSLD, 0) AS diasCaducidad,
              TRIM(A.IMSRP2) AS familia, TRIM(F.DRDL01) AS familiaDesc
       FROM F4101 A
       LEFT JOIN prodctl.f0005 F
         ON TRIM(F.DRKY) = TRIM(A.IMSRP2) AND TRIM(F.DRSY) = '41' AND TRIM(F.DRRT) = 'S2'
       WHERE TRIM(A.IMSRP1) = '12'
         AND TRIM(A.IMSRP6) = 'Y'
         AND TRIM(A.IMSTKT) NOT IN ('O', 'U')
         AND TRIM(A.IMLITM) IS NOT NULL
       ORDER BY TRIM(A.IMDSC1)`
    )
    const rows = (result.rows as any[])
      .map(r => ({
        id: String(r.ID || '').trim(),
        descripcion: String(r.DESCRIPCION || '').trim(),
        diasCaducidad: Number(r.DIASCADUCIDAD ?? 0),
        familia: String(r.FAMILIA || '').trim(),
        familiaDesc: String(r.FAMILIADESC || '').trim(),
      }))
      .filter(r => r.id)

    const db = getDb()
    const asociaciones = db.prepare(
      `SELECT am.articulo_id, m.id AS mensajeId, m.name AS messageName
       FROM loteadora_articulo_mensajes am
       JOIN loteadora_mensajes m ON m.id = am.mensaje_id`
    ).all() as { articulo_id: string; mensajeId: number; messageName: string }[]
    const campos = leerCampos(db)
    const plantillaPorArticulo = new Map(asociaciones.map(a => [a.articulo_id, {
      messageName: a.messageName, campos: campos.get(a.mensajeId) ?? [],
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
