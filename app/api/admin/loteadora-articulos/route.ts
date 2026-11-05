import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';
import { getDbConnection } from '@/lib/db';

// Por qué un artículo con plantilla ya no sale en /loteadora (mismos filtros que
// GET /api/loteadora/articulos): obsoleto (IMSTKT O/U), fuera (no cumple IMSRP1='12'
// o IMSRP6='Y') o no_existe (ya no está en la F4101). null = se puede usar.
type EstadoJde = 'obsoleto' | 'fuera' | 'no_existe' | null;

// Descripción, días de caducidad y estado en JDE de los artículos con plantilla.
// Solo de esos (no todo el catálogo), en bloques de 1000 (límite de IN en Oracle).
async function datosJde(ids: string[]) {
  const datos = new Map<string, { descripcion: string; diasCaducidad: number; estado: EstadoJde }>();
  if (ids.length === 0) return datos;
  let conn;
  try {
    conn = await getDbConnection();
    for (let i = 0; i < ids.length; i += 1000) {
      const bloque = ids.slice(i, i + 1000);
      const result = await conn.execute(
        `SELECT TRIM(IMLITM) AS ID, TRIM(IMDSC1) AS DESCRIPCION, NVL(IMSLD, 0) AS DIAS,
                TRIM(IMSTKT) AS STKT, TRIM(IMSRP1) AS SRP1, TRIM(IMSRP6) AS SRP6
         FROM F4101 WHERE TRIM(IMLITM) IN (${bloque.map((_, j) => `:id${j}`).join(',')})`,
        Object.fromEntries(bloque.map((id, j) => [`id${j}`, id]))
      );
      for (const r of result.rows as any[]) {
        const estado: EstadoJde = ['O', 'U'].includes(r.STKT) ? 'obsoleto'
          : r.SRP1 !== '12' || r.SRP6 !== 'Y' ? 'fuera' : null;
        datos.set(String(r.ID), { descripcion: String(r.DESCRIPCION ?? ''), diasCaducidad: Number(r.DIAS ?? 0), estado });
      }
    }
  } finally {
    if (conn) try { await conn.close(); } catch (e) { console.error(e); }
  }
  return datos;
}

// Lista las asociaciones artículo -> plantilla (SQLite) con la descripción, la
// caducidad y el estado en JDE de cada artículo, para ver las que ya no sirven
// (p. ej. un artículo que han pasado a obsoleto). Si JDE no responde, se devuelven
// igual, con jde = null: la tabla no depende de Oracle.
export async function GET() {
  const acceso = await requireAccess({ permiso: L('articulos') });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const asociaciones = db.prepare(
    `SELECT am.articulo_id, am.mensaje_id, m.name AS mensaje_name, am.created_at
     FROM loteadora_articulo_mensajes am
     JOIN loteadora_mensajes m ON m.id = am.mensaje_id
     ORDER BY am.articulo_id`
  ).all() as { articulo_id: string }[];

  let jde: Awaited<ReturnType<typeof datosJde>> | null = null;
  try {
    jde = await datosJde(asociaciones.map((a) => a.articulo_id));
  } catch (err) {
    console.error('Loteadora/admin artículos: no se pudo consultar JDE:', err);
  }
  return NextResponse.json(asociaciones.map((a) => ({
    ...a,
    jde: jde ? (jde.get(a.articulo_id) ?? { descripcion: null, diasCaducidad: null, estado: 'no_existe' }) : null,
  })));
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ permiso: L('articulos', 'editar') });
  if (!acceso.ok) return acceso.denied;

  const { articuloId, mensajeId } = await req.json();
  const cleanArticuloId = String(articuloId ?? '').trim();

  if (!/^\d{10}$/.test(cleanArticuloId)) {
    return NextResponse.json({ error: 'El artículo debe tener exactamente 10 dígitos' }, { status: 400 });
  }
  if (!Number.isInteger(Number(mensajeId))) {
    return NextResponse.json({ error: 'Falta la plantilla a asociar' }, { status: 400 });
  }

  const db = getDb();
  const mensaje = db.prepare('SELECT id FROM loteadora_mensajes WHERE id = ?').get(Number(mensajeId));
  if (!mensaje) {
    return NextResponse.json({ error: 'La plantilla indicada no existe' }, { status: 404 });
  }

  db.prepare(
    `INSERT INTO loteadora_articulo_mensajes (articulo_id, mensaje_id) VALUES (?, ?)
     ON CONFLICT(articulo_id) DO UPDATE SET mensaje_id = excluded.mensaje_id`
  ).run(cleanArticuloId, Number(mensajeId));

  return NextResponse.json({ ok: true }, { status: 201 });
}
