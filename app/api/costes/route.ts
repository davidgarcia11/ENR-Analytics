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
//   distinto al prefijo). Ver docs/costes.md §3.1.
// - Obsoletos: F4101.IMSTKT = 'O' (mismo campo que ya usa /caducados). La API
//   siempre devuelve TODOS los finales con el flag `obsoleto` — el filtrado
//   (un obsoleto solo se ve en la tabla si tuvo producción en el rango de
//   fechas elegido, ver `produccion` más abajo) es en el frontend, igual que
//   el resto de filtros de esta tabla (búsqueda, familia).
// - Producción real por artículo final, en un rango de fechas (`startDate`/
//   `endDate`, 'YYYY-MM-DD', mismo formato y mismo default —mes en curso— que
//   `/api/compras`; sin ellos, mes en curso): mismo patrón que
//   `/api/production` (F55TAR12 deduplicado → F4801 → F4111, `ILDCT='IC'`,
//   `ILTRQT`/100) pero SOLO para los finales (no para cada nodo del árbol, ni
//   desglosado por orden/turno/hora) y agregando por artículo con conversión
//   de unidades (F41002, factor BFS hasta 3 niveles) a la unidad primaria de
//   cada artículo (F4101.IMUOM1) — un mismo artículo puede tener producción
//   registrada en más de una UM. La lógica de conversión está DUPLICADA a
//   propósito desde `app/api/production/route.ts` en vez de compartida: ese
//   endpoint es "el más complejo" de la app (CLAUDE.md pide especial cuidado
//   al tocarlo) y esta consulta no necesita modificarlo para nada. Los
//   artículos finales se identifican aquí por código LARGO (`IMLITM`, ver
//   comentario más abajo), pero F4801/F4111/F41002 trabajan con el código
//   CORTO (`WAITM`/`IMITM`) — el cruce sale de `F4101.IMITM`, añadido a la
//   consulta de metadatos (paso G) solo para los finales, no para todo el
//   árbol. La producción se agrega TAMBIÉN por mes (no solo el total del
//   rango) — la usa el gráfico de barras "Producción por mes" (docs §3.5).
//   NO se usa para ponderar el coste real: ese pondera con la cantidad de sus
//   propias órdenes (ver punto siguiente).
// - Coste real por artículo, en el mismo rango de fechas (`costeReal` en TODOS
//   los nodos del árbol, no solo finales): sale de las ÓRDENES DE FABRICACIÓN
//   realmente costeadas — F554105 (`CLLEDG='CR'`, una fila por palet_lote, con
//   la orden `CLURAB`, su fecha `CLURDT` y su cantidad `CLSTOC`/10000, iguales
//   en todos los palets de la misma orden) cruzada con F55CR001
//   (`CRLEDG='CR'`, `CRDOCO`=orden), que desglosa el coste de cada orden por
//   componente (`CRCOST`: A1, X1...X9, y 'CR' que es el total), del que se coge
//   SOLO `A1` (Material) — el mismo componente que el coste teórico, para que
//   las dos cifras comparen lo mismo. `CRUNCS`/10000 es el importe de toda la
//   orden: el coste unitario es ese importe / cantidad de la orden, redondeado
//   a 4 decimales. El coste de un mes (o del
//   rango entero) es la media PONDERADA por la cantidad producida de esas
//   mismas órdenes — el peso sale de la misma fila que el coste, así que no
//   puede haber coste sin peso. Un artículo sin órdenes en el rango (todo lo
//   comprado, p.ej.) se queda con `costeReal: null`, que es lo correcto.
//   HISTÓRICO: antes esto salía de F30026 con un IELEDG distinto por mes,
//   mapeado a mano en /admin (tabla SQLite `coste_a1_coledg_mensual`, ya
//   eliminada) — pero esos ledgers mensuales no existen en F30026 (los códigos
//   que se configuraban eran de F4105.COLEDG, otra serie) y el coste real salía
//   `null` para todo. Antes de eso se leyó F4105.COUNCS, que era el coste total
//   del ledger y no el componente A1. Ver docs/costes.md §3.4.
import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear, isoToJulian } from '@/lib/utils';
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

// Suma de años+día juliano SIN el prefijo `100000 +` de `hoyJde()` — a propósito:
// se compara contra `MOD(TO55TAREA, 100000)` (mismo patrón que
// `app/api/production/route.ts`), que ya le quita ese mismo prefijo a la fecha
// de producción antes de comparar, así que aquí tampoco debe llevarlo.
function fechaAJdeProduccion(fecha: Date): number {
  return (fecha.getFullYear() - 2000) * 1000 + getDayOfYear(fecha);
}

// Inversa aproximada de fechaAJdeProduccion(): de un valor "yyddd" (sin el
// prefijo 100000+, mismo formato que MOD(TO55TAREA,100000)/MOD(ILTRDJ,100000))
// a su mes calendario 'YYYY-MM'. new Date(year, 0, ddd) normaliza solo el
// desbordamiento de días (ddd=32 -> 1 de febrero), igual que getDayOfYear().
function fechaJdeAMes(v: number): string {
  const yy = Math.floor(v / 1000);
  const ddd = v % 1000;
  const fecha = new Date(2000 + yy, 0, ddd);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}

// Lista de meses calendario 'YYYY-MM' entre dos fechas, ambos extremos
// incluidos (el rango del filtro solo deja elegir meses completos, ver
// MonthRangePicker).
function mesesEntreFechas(inicio: Date, fin: Date): string[] {
  const meses: string[] = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const finCursor = new Date(fin.getFullYear(), fin.getMonth(), 1);
  while (cursor <= finCursor) {
    meses.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return meses;
}

interface BomRow { K: string; L: string; QTY: number; UM: string }
interface BomLine { componente: string; qty: number; um: string }
// CORTO (F4101.IMITM) solo hace falta para cruzar con producción (F4801/F4111/
// F41002, que trabajan con código corto) — se pide para TODOS los códigos del
// árbol (misma consulta que el resto de metadatos) pero solo se usa para los
// finales.
interface MetaRow { LARGO: string; CORTO: string; DESCRIPCION: string; FAMILIA: string; TIPO_COD: string; STKT: string }
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
  // Coste real unitario (F554105 + F55CR001) en el rango de fechas pedido,
  // media ponderada por la cantidad producida de sus órdenes — en TODOS los
  // nodos del árbol (a diferencia de `produccion`, que solo tiene valor en la
  // raíz), cada uno con SUS propias órdenes. `null` si el artículo no tuvo
  // ninguna orden costeada en el rango (todo lo comprado, p.ej.). Ver
  // comentario de cabecera del archivo.
  costeReal: number | null;
  cantidad: number; // cantidad de este artículo por unidad de su padre directo (1 en la raíz)
  um: string;
  // Producción real (F4111, ILDCT='IC') en el rango de fechas pedido — SOLO
  // presente en los nodos raíz (artículos finales), `undefined` en el resto del
  // árbol (no se pide desglose de producción por componente). Ver comentario de
  // cabecera del archivo.
  produccion?: number;
  // Desglose mes a mes de producción y coste real — SOLO en la raíz, igual que
  // `produccion`. Es la materia prima del gráfico "Coste real vs. teórico por
  // mes" (`components/nova/coste-a1-monthly-chart.tsx`): ese gráfico agrega
  // VARIOS finales a la vez, así que necesita el detalle por mes de cada uno
  // por separado, no el agregado ya ponderado que da `costeReal`.
  // `costeRealPorMes[i].costeReal` es el coste de ESE mes (media ponderada de
  // las órdenes del mes) y `cantidad` la producción de esas órdenes, que es el
  // peso con el que el frontend combina varios artículos en un punto del
  // gráfico y con el que los KPI ponderan el rango completo. `cantidad: 0`
  // significa "sin órdenes ese mes" y va siempre con `costeReal: null`.
  produccionPorMes?: { mes: string; produccion: number }[];
  costeRealPorMes?: { mes: string; costeReal: number | null; cantidad: number }[];
  children: DespieceNode[];
}

export async function GET(req: NextRequest) {
  const denied = await requireScreenAccess('costes');
  if (denied) return denied;
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);

  // Rango de fechas para la producción real — mismo formato ('YYYY-MM-DD') y
  // mismo default (mes en curso) que `/api/compras`. El frontend solo deja
  // elegir MESES completos (`MonthRangePicker`), nunca días sueltos.
  const hoy = new Date();
  const inicioMesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  const finMesActualDate = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const finMesActual = `${finMesActualDate.getFullYear()}-${String(finMesActualDate.getMonth() + 1).padStart(2, '0')}-${String(finMesActualDate.getDate()).padStart(2, '0')}`;
  const startDateStr = searchParams.get('startDate') || inicioMesActual;
  const endDateStr = searchParams.get('endDate') || finMesActual;
  const startJdeProd = fechaAJdeProduccion(new Date(startDateStr));
  const endJdeProd = fechaAJdeProduccion(new Date(endDateStr));

  // Meses calendario del rango — eje X de los gráficos mensuales y rejilla
  // sobre la que se reparte el coste real de cada artículo (ver H.1).
  const mesesRango = mesesEntreFechas(new Date(startDateStr), new Date(endDateStr));

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
      return NextResponse.json({ finales: [], meta: { totalFinales: 0, articulosDistintos: 0, mesesRango } });
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
    // IMITM (código CORTO) se pide aquí de paso, junto al resto — solo se usa
    // después para los finales, al cruzar con producción (F4801/F4111/F41002).
    const metaResult = await conn.execute(
      `SELECT TRIM(IMLITM) AS LARGO, TRIM(IMITM) AS CORTO, TRIM(IMDSC1) AS DESCRIPCION, TRIM(IMSRP2) AS FAMILIA, TRIM(IMSRP1) AS TIPO_COD, TRIM(IMSTKT) AS STKT
       FROM F4101 WHERE TRIM(IMLITM) IN (${placeholders})`,
      binds
    );
    const metaMap = new Map((metaResult.rows as MetaRow[]).map((r) => [r.LARGO, r]));

    // G.1) Producción real (F4111, ILDCT='IC') de cada FINAL en el rango de fechas
    // — mismo patrón que /api/production (F55TAR12 deduplicado → F4801 → F4111),
    // simplificado: sin sub-línea/hora/merma, agregado directamente por artículo
    // (WAAITM, código LARGO — F4801 lo usa igual que el filtro de artículo de
    // /api/production) en vez de por orden/día/turno. Conversión de unidades
    // (F41002) porque un mismo artículo puede tener producción registrada en más
    // de una UM — ver comentario de cabecera.
    const produccionMap = new Map<string, number>(); // código LARGO -> cantidad en UM primaria
    // código LARGO -> mes 'YYYY-MM' -> cantidad en UM primaria. Solo se rellena
    // para el peso del coste real (ver comentario de cabecera) — produccionMap
    // (el total del rango) sigue siendo la fuente de la columna "Producción".
    const produccionMensualMap = new Map<string, Map<string, number>>();
    const finalesCortos = Array.from(
      new Set(finales.map((f) => metaMap.get(f)?.CORTO).filter((c): c is string => !!c))
    );
    if (finalesCortos.length > 0) {
      const finalesPlaceholders = finales.map((_, i) => `:fl${i}`).join(', ');
      const finalesBinds: Record<string, string> = {};
      finales.forEach((v, i) => { finalesBinds[`fl${i}`] = v; });

      const prodResult = await conn.execute(
        `SELECT TRIM(A.WAAITM) AS WAAITM, TRIM(A.WAITM) AS WAITM, C.ILTRUM,
           MOD(B.TO55TAREA, 100000) AS FECHA_JDE,
           SUM(CASE WHEN C.ILDCT = 'IC' THEN C.ILTRQT ELSE 0 END) AS QTY
         FROM (
           SELECT TODOCO, MAX(TO55TAREA) as TO55TAREA
           FROM F55TAR12
           GROUP BY TODOCO, MOD(TO55TAREA, 100000)
         ) B
         INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
         LEFT JOIN F4111 C ON C.ILDOC = A.WADOCO
           AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)
           AND C.ILDCT = 'IC'
         WHERE MOD(B.TO55TAREA, 100000) >= :startJdeProd AND MOD(B.TO55TAREA, 100000) <= :endJdeProd
           AND TRIM(A.WAAITM) IN (${finalesPlaceholders})
         GROUP BY A.WADOCO, B.TO55TAREA, A.WAAITM, A.WAITM, C.ILTRUM`,
        { startJdeProd, endJdeProd, ...finalesBinds }
      );
      const prodRows = prodResult.rows as { WAAITM: string; WAITM: string; ILTRUM: string | null; FECHA_JDE: number; QTY: number }[];

      if (prodRows.length > 0) {
        // Unidad primaria (F4101.IMUOM1) y conversiones (F41002), por código CORTO
        // — mismo patrón que /api/production.
        const cortosImplicados = Array.from(new Set(prodRows.map((r) => r.WAITM).filter(Boolean)));
        const cortosPlaceholders = cortosImplicados.map((_, i) => `:co${i}`).join(', ');
        const cortosBinds: Record<string, string> = {};
        cortosImplicados.forEach((v, i) => { cortosBinds[`co${i}`] = v; });

        const primUomResult = await conn.execute(
          `SELECT IMITM, IMUOM1 FROM F4101 WHERE IMITM IN (${cortosPlaceholders})`,
          cortosBinds
        );
        const primUomMap = new Map(
          (primUomResult.rows as { IMITM: string; IMUOM1: string }[]).map((r) => [String(r.IMITM).trim(), String(r.IMUOM1).trim()])
        );

        const convResult = await conn.execute(
          `SELECT UMITM, UMUM, UMRUM, UMCONV FROM F41002 WHERE UMITM IN (${cortosPlaceholders})`,
          cortosBinds
        );
        const conversionesPorArticulo = new Map<string, { from: string; to: string; factor: number }[]>();
        (convResult.rows as { UMITM: string; UMUM: string; UMRUM: string; UMCONV: number }[]).forEach((r) => {
          const id = String(r.UMITM).trim();
          if (!conversionesPorArticulo.has(id)) conversionesPorArticulo.set(id, []);
          conversionesPorArticulo.get(id)!.push({
            from: String(r.UMUM).trim(),
            to: String(r.UMRUM).trim(),
            factor: r.UMCONV / 10000000, // JDE guarda 1.0 como 10000000
          });
        });

        // BFS hasta 3 niveles — calcado de getConversionFactor() en
        // app/api/production/route.ts, duplicado a propósito (ver comentario de
        // cabecera del archivo: ese endpoint pide "especial cuidado" al tocarlo).
        function factorConversion(codigoCorto: string, desde: string, hasta: string): number | null {
          if (desde === hasta) return 1;
          const conversiones = conversionesPorArticulo.get(codigoCorto) ?? [];
          const cola: { um: string; factor: number; profundidad: number }[] = [{ um: desde, factor: 1, profundidad: 0 }];
          const visitados = new Set([desde]);
          while (cola.length > 0) {
            const actual = cola.shift()!;
            if (actual.profundidad >= 3) continue;
            for (const paso of conversiones.filter((c) => c.from === actual.um)) {
              const nuevoFactor = actual.factor * paso.factor;
              if (paso.to === hasta) return nuevoFactor;
              if (!visitados.has(paso.to)) {
                visitados.add(paso.to);
                cola.push({ um: paso.to, factor: nuevoFactor, profundidad: actual.profundidad + 1 });
              }
            }
          }
          return null;
        }

        for (const row of prodRows) {
          const corto = row.WAITM;
          const largo = row.WAAITM;
          const umPrimaria = primUomMap.get(corto) || (row.ILTRUM ? String(row.ILTRUM).trim() : 'EA');
          const umOrigen = row.ILTRUM ? String(row.ILTRUM).trim() : umPrimaria;
          const cantidadCruda = (row.QTY || 0) / 100; // ILTRQT viene ×100
          let cantidadFinal = cantidadCruda;
          if (umOrigen !== umPrimaria) {
            const factor = factorConversion(corto, umOrigen, umPrimaria);
            // Sin ruta de conversión conocida -> se suma sin convertir (mismo
            // comportamiento que /api/production en el mismo caso).
            if (factor !== null) cantidadFinal = cantidadCruda * factor;
          }
          produccionMap.set(largo, (produccionMap.get(largo) ?? 0) + cantidadFinal);

          const mes = fechaJdeAMes(row.FECHA_JDE);
          if (!produccionMensualMap.has(largo)) produccionMensualMap.set(largo, new Map());
          const porMes = produccionMensualMap.get(largo)!;
          porMes.set(mes, (porMes.get(mes) ?? 0) + cantidadFinal);
        }
      }
    }

    // H) Coste A1 (F30026), por código LARGO.
    const costResult = await conn.execute(
      `SELECT TRIM(IELITM) AS LARGO, IECSL AS COSTE_RAW
       FROM F30026
       WHERE TRIM(IELEDG) = '07' AND TRIM(IECOST) = 'A1' AND IEMMCU = ${PLANTA}
         AND TRIM(IELITM) IN (${placeholders})`,
      binds
    );
    const costMap = new Map((costResult.rows as CostRow[]).map((r) => [r.LARGO, r.COSTE_RAW / 10000]));

    // H.1) Coste real por artículo y mes (F554105 + F55CR001), para TODOS los
    // códigos del árbol (no solo finales) — cada artículo con órdenes de
    // fabricación propias tiene su propio coste real; los comprados (sin
    // órdenes) se quedan en `null`, que es lo correcto.
    //
    // F554105 (CLLEDG='CR') tiene una fila por palet_lote, pero el coste y la
    // cantidad son los de SU orden (CLURAB) repetidos en cada palet — de ahí el
    // DISTINCT (verificado con datos reales: la cantidad CLSTOC es idéntica en
    // todos los palets de una misma orden). F55CR001 (CRDOCO=orden,
    // CRLEDG='CR') es el desglose por componente de coste (A1, X1...X9, y 'CR'
    // que es el total). Se coge SOLO CRCOST='A1' (Material): es el mismo
    // componente que el coste teórico de §3.1 (F30026, IECOST='A1'), así que
    // las dos cifras comparan lo mismo y la desviación es de coste de
    // material, no la diferencia entre "todo el coste" y "una parte".
    // CRUNCS/10000 es el importe de TODA la orden, no unitario, así que se
    // divide entre la cantidad producida (CLSTOC/10000) y se redondea a 4
    // decimales.
    //
    // Sustituye a la versión anterior (F30026 con un IELEDG distinto por mes,
    // mapeado a mano en /admin): esos ledgers mensuales no existen en F30026 —
    // los códigos que se configuraban salían de F4105.COLEDG, que es otra serie
    // — y el coste real salía `null` para todo. Con esta fuente no hay nada que
    // configurar a mano.
    const startJdeCR = isoToJulian(startDateStr);
    const endJdeCR = isoToJulian(endDateStr);
    const costeRealResult = await conn.execute(
      `WITH ordenes AS (
         SELECT DISTINCT TRIM(i.IMLITM) AS LARGO, c.CLURAB AS ORDEN,
                c.CLURDT AS FECHA_JDE, c.CLSTOC / 10000 AS CANTIDAD
         FROM F554105 c
         JOIN F4101 i ON i.IMITM = c.CLITM
         WHERE TRIM(c.CLLEDG) = 'CR'
           AND c.CLURDT BETWEEN :startJdeCR AND :endJdeCR
           AND TRIM(i.IMLITM) IN (${placeholders})
       ),
       por_orden AS (
         SELECT o.LARGO, o.FECHA_JDE, o.CANTIDAD,
                SUM(ROUND((r.CRUNCS / 10000) / NULLIF(o.CANTIDAD, 0), 4)) AS COSTE_UNIT
         FROM ordenes o
         JOIN F55CR001 r ON r.CRDOCO = o.ORDEN
         WHERE TRIM(r.CRLEDG) = 'CR' AND TRIM(r.CRCOST) = 'A1'
         GROUP BY o.LARGO, o.FECHA_JDE, o.ORDEN, o.CANTIDAD
       )
       SELECT LARGO, FECHA_JDE,
              SUM(COSTE_UNIT * CANTIDAD) AS IMPORTE,
              SUM(CANTIDAD) AS CANTIDAD
       FROM por_orden
       GROUP BY LARGO, FECHA_JDE`,
      { startJdeCR, endJdeCR, ...binds }
    );
    // LARGO -> mes 'YYYY-MM' -> { importe, cantidad }. Se guardan los dos
    // sumatorios en vez del coste ya dividido: así se pueden agregar varios
    // meses (aquí) o varios artículos (en el frontend, para los gráficos) sin
    // perder el peso de cada uno.
    const costeRealPorArticulo = new Map<string, Map<string, { importe: number; cantidad: number }>>();
    (costeRealResult.rows as { LARGO: string; FECHA_JDE: number; IMPORTE: number; CANTIDAD: number }[]).forEach((r) => {
      // CLURDT lleva el prefijo de siglo (CYYDDD, p.ej. 126182); fechaJdeAMes()
      // espera el valor sin él, igual que MOD(TO55TAREA, 100000) más arriba.
      const mes = fechaJdeAMes(r.FECHA_JDE % 100000);
      if (!costeRealPorArticulo.has(r.LARGO)) costeRealPorArticulo.set(r.LARGO, new Map());
      const porMes = costeRealPorArticulo.get(r.LARGO)!;
      const acc = porMes.get(mes) ?? { importe: 0, cantidad: 0 };
      acc.importe += r.IMPORTE;
      acc.cantidad += r.CANTIDAD;
      porMes.set(mes, acc);
    });

    // Coste real del rango completo: media ponderada por la cantidad producida
    // de las MISMAS órdenes que dan el coste — no por la producción de F4111,
    // que es otra fuente y puede no cuadrar (antes sí lo era, y de ahí salían
    // los casos de "coste sin peso" que había que parchear con una media
    // simple). Con un solo mes en el rango es directamente el coste de ese mes.
    // `null` si el artículo no tuvo órdenes en el rango.
    function costeRealNodo(codigo: string): number | null {
      const porMes = costeRealPorArticulo.get(codigo);
      if (!porMes) return null;
      let importe = 0;
      let cantidad = 0;
      porMes.forEach((v) => { importe += v.importe; cantidad += v.cantidad; });
      return cantidad > 0 ? importe / cantidad : null;
    }

    // Asigna `costeReal` a todo el subárbol — cada nodo con SUS propias órdenes.
    // Antes heredaba los pesos mensuales del artículo final, porque el coste
    // venía de una tabla que no sabía nada de órdenes de fabricación.
    function asignarCosteReal(n: DespieceNode): void {
      n.costeReal = costeRealNodo(n.codigo);
      n.children.forEach(asignarCosteReal);
    }

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
        costeReal: null, // se rellena después con asignarCosteReal() — depende de los pesos del final
        cantidad: Math.round(n.cantidad * 1000) / 1000,
        um: n.um,
        children: n.children
          .map(enriquecer)
          .sort((a, b) => b.cantidad - a.cantidad),
      };
    }
    const finalesOut = arboles.map(enriquecer).sort((a, b) => (b.costeA1 ?? -1) - (a.costeA1 ?? -1));

    // `produccion` solo en la raíz (artículo final) — ver comentario del campo en
    // DespieceNode. `enriquecer()` ya deja `produccion` como `undefined` en todo
    // el árbol (no está en el objeto que devuelve); aquí se rellena SOLO para los
    // finales, con lo que haya en produccionMap (0 si no tuvo producción real).
    // `costeReal` sí se rellena en TODO el árbol de cada final, con los pesos
    // mensuales (producción) de ESE final — ver asignarCosteReal() más arriba.
    finalesOut.forEach((f) => {
      f.produccion = produccionMap.get(f.codigo) ?? 0;
      asignarCosteReal(f);
      f.produccionPorMes = mesesRango.map((mes) => ({ mes, produccion: produccionMensualMap.get(f.codigo)?.get(mes) ?? 0 }));
      f.costeRealPorMes = mesesRango.map((mes) => {
        const acc = costeRealPorArticulo.get(f.codigo)?.get(mes);
        return {
          mes,
          costeReal: acc && acc.cantidad > 0 ? acc.importe / acc.cantidad : null,
          cantidad: acc?.cantidad ?? 0,
        };
      });
    });

    // Registrar consulta en logs (nunca bloquea la respuesta) — mismo patrón que
    // /api/compras y /api/mrp.
    try {
      const user = await verifySession().catch(() => null);
      const db = getDb();
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user?.id ?? null, user ? user.username : 'Invitado', 'coste_a1', JSON.stringify({ startDate: startDateStr, endDate: endDateStr }), finalesOut.length, Date.now() - startTime);
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({
      finales: finalesOut,
      meta: {
        totalFinales: finalesOut.length,
        articulosDistintos: codigos.length,
        // Meses calendario 'YYYY-MM' del rango pedido, en orden — el frontend
        // los usa como eje X del gráfico mensual en vez de recalcularlos.
        mesesRango,
      },
    });
  } catch (error) {
    console.error('Error en /api/costes:', error);
    return NextResponse.json({ error: 'Error al calcular el coste y despiece' }, { status: 500 });
  } finally {
    if (conn) {
      try { await conn.close(); } catch (e) { console.error('Error cerrando conexión Oracle:', e); }
    }
  }
}
