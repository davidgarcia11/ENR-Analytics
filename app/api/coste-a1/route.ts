// Coste A1 y despiece recursivo de materiales: para cada artículo "final" (el que
// realmente se vende — ver más abajo), muestra su coste A1 (F30026) y el árbol
// completo de la lista de materiales (F3002, planta 10999) que hace falta para
// fabricarlo, nivel a nivel (12 → 11 → 11 → 10 → materia prima...), en vez de
// aplanarlo a solo materia prima como hace /api/mrp.
//
// Lógica confirmada con el usuario (ver ClickUp #869eq7vnp):
// - Coste A1: F30026, IELEDG='07' (Coste Estándar), IECOST='A1', IEMMCU=10999,
//   importe = IECSL / 10000.
// - "Artículo final" (el que se vende) — dos casos, no uno:
//   1) Estructural: tiene lista de materiales propia (aparece como IXKITL) y NUNCA
//      aparece como componente (IXLITM) de ninguna otra línea. Esto ya captura el
//      final real de una cadena de reprocesado (ver caso 2).
//   2) Por tipo: un "12" (Terminado) o "99" (Comercializado) con lista de
//      materiales propia SIEMPRE se lista como final, aunque también aparezca como
//      componente de otra línea — un "12" que normalmente se vende tal cual puede
//      reprocesarse solo A VECES (confirmado en datos reales: 1210100242 se vende
//      normalmente, pero también se consume como componente de 1110100295, que a su
//      vez lo consume 1110100296 — la cadena de reprocesado). El reprocesado es una
//      salida ocasional, no la única, así que el "12"/"99" original tiene que salir
//      también por su cuenta con su propio despiece (caso 1 ya captura aparte el
//      final de la cadena de reprocesado, 1110100296 en el ejemplo). Un mismo
//      código puede así aparecer como final por sí mismo Y anidado dentro del
//      despiece de otro final — no es un duplicado, son dos hechos reales
//      distintos ("si se vende tal cual" / "si se reprocesa").
// - Vigencia del BOM: evaluada a HOY (no hay una fecha de previsión que ancle el
//   panel, a diferencia de MRP) — foto del estado actual de las listas de
//   materiales, no histórica.
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from '@/lib/utils';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

const PLANTA = 10999;
const TIPO_LABEL: Record<string, string> = {
  '10': 'Semielaborado',
  '11': 'Semiterminado',
  '12': 'Terminado',
  '99': 'Comercializado',
};
function tipoDe(codigo: string): string {
  return TIPO_LABEL[codigo.slice(0, 2)] || 'Materia prima';
}

function hoyJde(): number {
  const hoy = new Date();
  return 100000 + (hoy.getFullYear() - 2000) * 1000 + getDayOfYear(hoy);
}

interface BomRow { K: string; L: string; QTY: number; UM: string }
interface BomLine { componente: string; qty: number; um: string }
interface MetaRow { LARGO: string; DESCRIPCION: string; FAMILIA: string }
interface CostRow { LARGO: string; COSTE_RAW: number }

export interface DespieceNode {
  codigo: string;
  descripcion: string;
  familia: string;
  familiaDescripcion: string;
  tipo: string;
  costeA1: number | null;
  cantidad: number; // cantidad de este artículo por unidad de su padre directo (1 en la raíz)
  um: string;
  children: DespieceNode[];
}

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('coste_a1');
  if (denied) return denied;
  const startTime = Date.now();

  let conn;
  try {
    conn = await getDbConnection();

    // A) Lista de materiales (F3002) vigente HOY, planta 10999.
    const bomResult = await conn.execute(
      `SELECT TRIM(IXKITL) AS K, TRIM(IXLITM) AS L, IXQNTY AS QTY, TRIM(IXUM) AS UM
       FROM F3002
       WHERE TRIM(IXCMCU) = '10999' AND IXEFFF <= :hoy AND (IXEFFT >= :hoy OR IXEFFT = 0)`,
      { hoy: hoyJde() }
    );
    const bomRows = bomResult.rows as BomRow[];

    // B) Índices: hijos directos de cada padre, y quién aparece alguna vez como
    // componente (para detectar reprocesado y decidir qué es "final").
    const childrenOf = new Map<string, BomLine[]>();
    const esComponenteDeAlgo = new Set<string>();
    const padres = new Set<string>();
    for (const r of bomRows) {
      if (!childrenOf.has(r.K)) childrenOf.set(r.K, []);
      childrenOf.get(r.K)!.push({ componente: r.L, qty: r.QTY / 10000, um: r.UM });
      esComponenteDeAlgo.add(r.L);
      padres.add(r.K);
    }

    // C) Finales = tienen lista de materiales propia y (nunca son componente de nada
    // O son tipo Terminado/Comercializado — ver comentario de cabecera, caso 2).
    const finales = Array.from(padres)
      .filter((p) => !esComponenteDeAlgo.has(p) || tipoDe(p) === 'Terminado' || tipoDe(p) === 'Comercializado')
      .sort();

    if (finales.length === 0) {
      return NextResponse.json({ finales: [], meta: { totalFinales: 0, articulosDistintos: 0 } });
    }

    // D) Construir el árbol de cada final (con corte de ciclos — un BOM real no
    // debería tener ninguno, pero un ciclo aquí colgaría la petición si no se corta).
    interface RawNode { codigo: string; cantidad: number; um: string; children: RawNode[] }
    function construir(codigo: string, cantidad: number, um: string, visitados: Set<string>): RawNode {
      const hijos = childrenOf.get(codigo) ?? [];
      return {
        codigo,
        cantidad,
        um,
        children: hijos
          .filter((h) => !visitados.has(h.componente))
          .map((h) => construir(h.componente, h.qty, h.um, new Set(visitados).add(h.componente))),
      };
    }
    const arboles = finales.map((f) => construir(f, 1, '', new Set([f])));

    // E) Códigos distintos en todos los árboles (para los lookups en lote).
    const codigosDistintos = new Set<string>();
    function recolectar(n: RawNode) { codigosDistintos.add(n.codigo); n.children.forEach(recolectar); }
    arboles.forEach(recolectar);
    const codigos = Array.from(codigosDistintos);
    const placeholders = codigos.map((_, i) => `:c${i}`).join(', ');
    const binds: Record<string, string> = {};
    codigos.forEach((v, i) => { binds[`c${i}`] = v; });

    // F) Descripción + familia (F4101, por código LARGO — evita el mapeo largo/corto).
    const metaResult = await conn.execute(
      `SELECT TRIM(IMLITM) AS LARGO, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA
       FROM F4101 WHERE TRIM(IMLITM) IN (${placeholders})`,
      binds
    );
    const metaMap = new Map((metaResult.rows as MetaRow[]).map((r) => [r.LARGO, r]));

    // G) Coste A1 (F30026), por código LARGO.
    const costResult = await conn.execute(
      `SELECT TRIM(IELITM) AS LARGO, IECSL AS COSTE_RAW
       FROM F30026
       WHERE TRIM(IELEDG) = '07' AND TRIM(IECOST) = 'A1' AND IEMMCU = ${PLANTA}
         AND TRIM(IELITM) IN (${placeholders})`,
      binds
    );
    const costMap = new Map((costResult.rows as CostRow[]).map((r) => [r.LARGO, r.COSTE_RAW / 10000]));

    // H) Catálogo de familia (UDC 41/S2) — mismo patrón que /api/compras y /api/mrp.
    const familiaCatalogResult = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S2' AND TRIM(DRKY) IS NOT NULL`
    );
    const familiaDescMap = new Map(
      (familiaCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, r.DESCRIPCION])
    );

    // I) RawNode -> DespieceNode, resolviendo meta/coste/familia. Hijos ordenados por
    // cantidad descendente (los componentes más relevantes primero).
    function enriquecer(n: RawNode): DespieceNode {
      const meta = metaMap.get(n.codigo);
      const familia = meta?.FAMILIA || '';
      return {
        codigo: n.codigo,
        descripcion: meta?.DESCRIPCION || '',
        familia,
        familiaDescripcion: familiaDescMap.get(familia) || familia || 'Sin familia',
        tipo: tipoDe(n.codigo),
        costeA1: costMap.get(n.codigo) ?? null,
        cantidad: Math.round(n.cantidad * 1000) / 1000,
        um: n.um,
        children: n.children
          .map(enriquecer)
          .sort((a, b) => b.cantidad - a.cantidad),
      };
    }
    const finalesOut = arboles.map(enriquecer).sort((a, b) => (b.costeA1 ?? -1) - (a.costeA1 ?? -1));

    // Registrar consulta en logs (nunca bloquea la respuesta) — mismo patrón que
    // /api/compras y /api/mrp.
    try {
      const user = await verifySession().catch(() => null);
      const db = getDb();
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user?.id ?? null, user ? user.username : 'Invitado', 'coste_a1', '{}', finalesOut.length, Date.now() - startTime);
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({
      finales: finalesOut,
      meta: { totalFinales: finalesOut.length, articulosDistintos: codigos.length },
    });
  } catch (error) {
    console.error('Error en /api/coste-a1:', error);
    return NextResponse.json({ error: 'Error al calcular el coste y despiece' }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}
