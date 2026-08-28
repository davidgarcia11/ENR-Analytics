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
//   2) Por tipo: un artículo cuya categoría real es "PRODUCTO TERMINADO" (ver más
//      abajo de dónde sale) y tiene lista de materiales propia SIEMPRE se lista
//      como final, aunque también aparezca como componente de otra línea — un "12"
//      que normalmente se vende tal cual puede reprocesarse solo A VECES
//      (confirmado en datos reales: 1210100242 se vende normalmente, pero también
//      se consume como componente de 1110100295, que a su vez lo consume
//      1110100296 — la cadena de reprocesado). El reprocesado es una salida
//      ocasional, no la única, así que el "12" original tiene que salir también
//      por su cuenta con su propio despiece (caso 1 ya captura aparte el final de
//      la cadena de reprocesado, 1110100296 en el ejemplo). Un mismo código puede
//      así aparecer como final por sí mismo Y anidado dentro del despiece de otro
//      final — no es un duplicado, son dos hechos reales distintos ("si se vende
//      tal cual" / "si se reprocesa").
// - Vigencia del BOM: evaluada a HOY (no hay una fecha de previsión que ancle el
//   panel, a diferencia de MRP) — foto del estado actual de las listas de
//   materiales, no histórica.
// - Tipo de artículo (Terminado/Semiterminado/.../Materia prima): NO es un guess por
//   prefijo del código largo — es el campo real F4101.IMSRP1 ("Categoría", UDC
//   41/S1), el mismo campo que ya usa el filtro "Categoría" de /produccion
//   (api/categories/route.ts, field=srp1). Comprobado con datos reales que el
//   prefijo NO es fiable del todo: casi todos los "99" (8 de 9) tienen SRP1='12'
//   (PRODUCTO TERMINADO), no una categoría "Comercializado" que ni existe en el
//   catálogo real — y hay excepciones sueltas en otros prefijos (13/14 con SRP1
//   distinto al prefijo). Ver docs/coste-a1.md §3.1.
// - Obsoletos: F4101.IMSTKT = 'O' (mismo campo que ya usa /caducados). La API
//   siempre devuelve TODOS los finales con el flag `obsoleto` — el filtrado
//   (ocultos por defecto, botón "Mostrar obsoletos" para verlos) es en el
//   frontend, igual que el resto de filtros de esta tabla (búsqueda, familia).
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from '@/lib/utils';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

const PLANTA = 10999;
const TIPO_TERMINADO = '12'; // F4101.IMSRP1 = '12' -> catálogo UDC 41/S1 "PRODUCTO TERMINADO"
// UDC 41/S1 viene en MAYÚSCULAS en el catálogo (mismo caso que familia, 41/S2) —
// mismo tratamiento sentence-case que docs/compras.md §3.2, no se muestra a gritos.
const capitalizarFrase = (s: string) => (s.length ? s.charAt(0) + s.slice(1).toLowerCase() : s);

function hoyJde(): number {
  const hoy = new Date();
  return 100000 + (hoy.getFullYear() - 2000) * 1000 + getDayOfYear(hoy);
}

interface BomRow { K: string; L: string; QTY: number; UM: string }
interface BomLine { componente: string; qty: number; um: string }
interface MetaRow { LARGO: string; DESCRIPCION: string; FAMILIA: string; TIPO_COD: string; STKT: string }
interface CostRow { LARGO: string; COSTE_RAW: number }

export interface DespieceNode {
  codigo: string;
  descripcion: string;
  familia: string;
  familiaDescripcion: string;
  tipo: string;
  tipoCod: string; // código crudo de F4101.IMSRP1 ('10'/'11'/'12'/...) — para lógica
  // (podar1112 en el frontend), nunca comparar por el texto de `tipo` (cambia si
  // cambia el catálogo).
  obsoleto: boolean; // F4101.IMSTKT = 'O' — mismo campo que ya usa /caducados
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

    // C) Categoría real (F4101.IMSRP1) de los artículos con BOM propia — hace falta
    // ANTES de decidir los finales (caso 2 de la cabecera), no solo para mostrar.
    const padresArr = Array.from(padres);
    const padresPlaceholders = padresArr.map((_, i) => `:pp${i}`).join(', ');
    const padresBinds: Record<string, string> = {};
    padresArr.forEach((v, i) => { padresBinds[`pp${i}`] = v; });
    const tipoPadresResult = await conn.execute(
      `SELECT TRIM(IMLITM) AS LARGO, TRIM(IMSRP1) AS TIPO_COD FROM F4101 WHERE TRIM(IMLITM) IN (${padresPlaceholders})`,
      padresBinds
    );
    const tipoPadresMap = new Map(
      (tipoPadresResult.rows as { LARGO: string; TIPO_COD: string }[]).map((r) => [r.LARGO, r.TIPO_COD])
    );

    // D) Finales = tienen lista de materiales propia y (nunca son componente de nada
    // O su categoría real es "PRODUCTO TERMINADO" — ver comentario de cabecera, caso 2).
    const finales = padresArr
      .filter((p) => !esComponenteDeAlgo.has(p) || tipoPadresMap.get(p) === TIPO_TERMINADO)
      .sort();

    if (finales.length === 0) {
      return NextResponse.json({ finales: [], meta: { totalFinales: 0, articulosDistintos: 0 } });
    }

    // E) Construir el árbol de cada final (con corte de ciclos — un BOM real no
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

    // F) Códigos distintos en todos los árboles (para los lookups en lote).
    const codigosDistintos = new Set<string>();
    function recolectar(n: RawNode) { codigosDistintos.add(n.codigo); n.children.forEach(recolectar); }
    arboles.forEach(recolectar);
    const codigos = Array.from(codigosDistintos);
    const placeholders = codigos.map((_, i) => `:c${i}`).join(', ');
    const binds: Record<string, string> = {};
    codigos.forEach((v, i) => { binds[`c${i}`] = v; });

    // G) Descripción + familia + categoría/tipo real + obsoleto (F4101, por código
    // LARGO — evita el mapeo largo/corto). IMSRP1 = categoría real (ver comentario
    // de cabecera) — mismo campo que el filtro "Categoría" de /produccion. IMSTKT =
    // 'O' -> obsoleto, mismo campo que ya usa /caducados (api/caducados/route.ts).
    const metaResult = await conn.execute(
      `SELECT TRIM(IMLITM) AS LARGO, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA, TRIM(IMSRP1) AS TIPO_COD, TRIM(IMSTKT) AS STKT
       FROM F4101 WHERE TRIM(IMLITM) IN (${placeholders})`,
      binds
    );
    const metaMap = new Map((metaResult.rows as MetaRow[]).map((r) => [r.LARGO, r]));

    // H) Coste A1 (F30026), por código LARGO.
    const costResult = await conn.execute(
      `SELECT TRIM(IELITM) AS LARGO, IECSL AS COSTE_RAW
       FROM F30026
       WHERE TRIM(IELEDG) = '07' AND TRIM(IECOST) = 'A1' AND IEMMCU = ${PLANTA}
         AND TRIM(IELITM) IN (${placeholders})`,
      binds
    );
    const costMap = new Map((costResult.rows as CostRow[]).map((r) => [r.LARGO, r.COSTE_RAW / 10000]));

    // I) Catálogo de familia (UDC 41/S2) y de categoría/tipo (UDC 41/S1) — mismo
    // patrón que /api/compras y /api/mrp. Ambos vienen en MAYÚSCULAS del catálogo
    // (docs/compras.md §3.2), de ahí capitalizarFrase().
    const familiaCatalogResult = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S2' AND TRIM(DRKY) IS NOT NULL`
    );
    const familiaDescMap = new Map(
      (familiaCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, capitalizarFrase(r.DESCRIPCION)])
    );
    const tipoCatalogResult = await conn.execute(
      `SELECT TRIM(DRKY) AS CODE, TRIM(DRDL01) AS DESCRIPCION FROM prodctl.f0005 WHERE TRIM(DRSY) = '41' AND TRIM(DRRT) = 'S1' AND TRIM(DRKY) IS NOT NULL`
    );
    const tipoDescMap = new Map(
      (tipoCatalogResult.rows as { CODE: string; DESCRIPCION: string }[]).map((r) => [r.CODE, capitalizarFrase(r.DESCRIPCION)])
    );

    // J) RawNode -> DespieceNode, resolviendo meta/coste/familia/tipo. Hijos
    // ordenados por cantidad descendente (los componentes más relevantes primero).
    function enriquecer(n: RawNode): DespieceNode {
      const meta = metaMap.get(n.codigo);
      const familia = meta?.FAMILIA || '';
      return {
        codigo: n.codigo,
        descripcion: meta?.DESCRIPCION || '',
        familia,
        familiaDescripcion: familiaDescMap.get(familia) || familia || 'Sin familia',
        tipo: (meta?.TIPO_COD && tipoDescMap.get(meta.TIPO_COD)) || 'Sin categoría',
        tipoCod: meta?.TIPO_COD || '',
        obsoleto: meta?.STKT === 'O',
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
