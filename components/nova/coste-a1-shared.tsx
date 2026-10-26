"use client";

// Helpers compartidos entre la tabla (coste-a1-table.tsx) y el panel de desglose
// (coste-a1-desglose-panel.tsx) — antes vivían todos dentro de la tabla, cuando el
// desglose era un modal propio de ese archivo; al pasar el desglose a un panel
// aparte (columna derecha) se extraen aquí para no duplicarlos.
import { cn } from "@/lib/utils";
import type { DespieceNode } from "@/app/api/costes/route";

export type { DespieceNode };

// El coste sale de dividir IECSL entre 10000 (F30026) — hasta 4 decimales con
// significado real. Redondear a 2 como el resto de importes de la app perdía
// precisión real (ej. 0,6454 € se veía como 0,65 €), así que aquí se muestran
// todos los decimales que tenga, no solo 2.
export function euros(v: number): string {
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

// Desviación del coste real (A1 de las órdenes costeadas, ponderado) frente al
// coste teórico declarado (F30026, A1) en %. Positivo = el real sale más caro que el estándar.
// `null` si falta cualquiera de los dos datos, o si el teórico es 0 (división
// por cero sin sentido económico). Recibe solo los dos campos que hacen
// falta (no el DespieceNode completo) para poder reutilizarse también desde
// TreeRow (coste-a1-table.tsx), que no lleva todos los campos del nodo.
export function desviacionPct(n: { costeA1: number | null; costeReal: number | null }): number | null {
  if (n.costeA1 == null || n.costeReal == null || n.costeA1 === 0) return null;
  return ((n.costeReal - n.costeA1) / n.costeA1) * 100;
}

// Píldora de color para la desviación — calcada de `Descuadre` (mismos
// tokens `bg-color/10 text-color`, mismo `rounded-full px-2 py-0.5`) en vez
// de texto suelto en color — pedido explícito: "quiero que en el desglose de
// componentes salga el porcentaje con fondo, como en la foto". Positivo (el
// real sale más caro que el teórico) = rojo, igual criterio de color que ya
// usaba el texto suelto.
export function DesviacionBadge({ pct, tono = "text" }: { pct: number; tono?: "text" | "xs" }) {
  const base = "rounded-full px-2 py-0.5 font-semibold tabular-nums";
  const cls = tono === "xs" ? "text-[11px]" : "text-xs";
  const positivo = pct > 0;
  return (
    <span
      className={cn(
        base,
        cls,
        positivo
          ? "bg-[color:var(--color-destructive)]/10 text-[color:var(--color-destructive)]"
          : "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
      )}
    >
      {positivo ? "+" : ""}
      {pct.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
    </span>
  );
}

// El informe (tabla principal) y el desglose solo deben enseñar niveles "11"/"12" —
// nada de envases/etiquetas/materia prima (10, 13, 14...). Poda recursiva por TIPO,
// no por profundidad: una cadena 12 → 11 → 11 sigue viéndose entera, pero en cuanto
// un nodo no es 11/12 se corta ahí (y con él, todo lo que cuelgue debajo). Compara
// por `tipoCod` (código real de F4101.IMSRP1: '11'/'12'), NUNCA por el texto de
// `tipo` — ese texto sale del catálogo UDC 41/S1 y puede no ser literalmente
// "Semiterminado"/"Terminado".
export function podar1112(n: DespieceNode): DespieceNode {
  return {
    ...n,
    children: n.children
      .filter((c) => c.tipoCod === "11" || c.tipoCod === "12")
      .map(podar1112),
  };
}

// Tolerancia de redondeo compartida — el coste declarado en F30026 y la suma
// recalculada no tienen por qué llevar exactamente los mismos decimales.
export const TOLERANCIA = 0.01;

// Dos estados. Hubo un tercero ("incompleto"/"Sin verificar" en ámbar) para el caso
// de un componente DIRECTO sin coste A1 propio: la suma lo trataba como 0 igualmente
// (para no bloquear el cálculo), pero se consideraba que "cuadrar" en ese caso podía
// ser pura coincidencia, así que nunca se afirmaba "Coincide" sin todos los costes.
// Revertido a petición explícita: "si coincide la suma de los componentes tiene que
// salir aunque uno no tenga coste, porque igual es algún producto como tinta que es
// incalculable" — un componente sin coste A1 (consumibles tipo tinta, etc.) es
// tratado como 0 SIEMPRE y se confía en el resultado de la suma, sin advertencia
// intermedia. Ver `git log` de este archivo para el razonamiento original si hiciera
// falta reinstaurarlo.
export type EstadoDescuadre = "ok" | "problema";

// ¿Los hijos DIRECTOS de `n` suman su coste A1 declarado? Solo mira ESTE nivel — ver
// estadoSubarbol() para el recorrido recursivo completo. Un hijo sin coste A1 propio
// cuenta como 0 en la suma.
export function estadoLocal(n: DespieceNode): EstadoDescuadre {
  if (n.children.length === 0 || n.costeA1 == null) return "ok"; // nada que comprobar en este nivel
  const sumaDirecta = n.children.reduce((s, c) => s + c.cantidad * (c.costeA1 ?? 0), 0);
  return Math.abs(sumaDirecta - n.costeA1) < TOLERANCIA ? "ok" : "problema";
}

// Recorre TODO el subárbol de `n` (el propio nodo y cualquier descendiente): si hay
// un descuadre en cualquier punto, "problema" gana siempre — no basta con mirar el
// total del nodo raíz, dos descuadres internos podrían compensarse por casualidad y
// la suma final "cuadrar" sin que nada esté realmente bien.
export function estadoSubarbol(n: DespieceNode): EstadoDescuadre {
  const estados = [estadoLocal(n), ...n.children.map(estadoSubarbol)];
  return estados.includes("problema") ? "problema" : "ok";
}

// Píldora de color — calcada literalmente de la fila de factura del propio
// `tabs-08.tsx` (`BillingPanel`, pestaña "Billing" de la demo real de
// ShadcnSpace: badges "Paid" en verde / "Overdue" en rojo, `rounded-full px-2
// py-0.5 text-[11px] font-semibold`). Pedido explícito tras ver esa captura:
// "yo me refería a cómo se ve en shadcnspace... que el texto se ilumine verde o
// amarillo". Sin icono — el original tampoco lleva uno dentro de la píldora.
// Sin el importe del descuadre — pedido explícito: "que ponga 'NO OK' ya que
// en el desglose ya sale" (el propio Teórico/Real de al lado ya deja ver la
// diferencia, no hace falta repetirla en la píldora). `valor` ya no hace
// falta como prop — quitado también de las dos llamadas.
export function Descuadre({ estado, tono = "text" }: { estado: EstadoDescuadre; tono?: "text" | "xs" }) {
  const base = "rounded-full px-2 py-0.5 font-semibold";
  const cls = tono === "xs" ? "text-[11px]" : "text-xs";
  if (estado === "ok") {
    return <span className={cn(base, cls, "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]")}>Coincide</span>;
  }
  return (
    <span className={cn(base, cls, "bg-[color:var(--color-destructive)]/10 text-[color:var(--color-destructive)]")}>
      NO OK
    </span>
  );
}

// --- Gráfico "Coste real vs. teórico por mes" (coste-a1-monthly-charts.tsx) ---
//
// Agrega VARIOS finales a la vez (a diferencia de `costeReal`/`desviacionPct`,
// que son por artículo) — mismo criterio de ponderación que ya usa la API para
// un solo artículo (ver app/api/costes/route.ts, §3.4 de docs/costes.md),
// extendido para combinar varios artículos en un único punto por mes: cada
// final pesa según la cantidad que se produjo de él ese mes en las órdenes que
// dan el coste.
//
// Confirmado con el usuario: el Teórico del gráfico también se pondera
// (aunque el coste A1 de cada artículo, individualmente, nunca cambia) — si no, la distancia entre las dos líneas mezclaría dos efectos
// distintos (desviación de coste real + cambio de mix de producción) en vez
// de aislar solo el primero. Y las dos series usan la MISMA población de
// artículos con peso en cada mes: un final sin coste real ese mes (ninguna
// orden costeada) tampoco cuenta en el Teórico de ese mes, aunque sí tenga
// coste A1 — para que Real y Teórico sean
// comparables punto a punto, no medias sobre conjuntos distintos.
//
// La tabla (por artículo) NO usa nada de esto — su Teórico sigue siendo
// siempre el valor fijo de F30026, sin ponderar ni agregar con nada.

const MES_LABEL_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// 'YYYY-MM' -> "ene 26" (año a 2 dígitos: el eje X necesita quedar compacto
// con hasta 12 puntos).
export function formatMesCorto(mes: string): string {
  const [anio, m] = mes.split("-").map(Number);
  return `${MES_LABEL_CORTO[m - 1]} ${String(anio).slice(2)}`;
}

export interface CosteMensualPunto { mes: string; teorico: number | null; real: number | null }

export function serieCosteMensual(finales: DespieceNode[], mesesRango: string[]): CosteMensualPunto[] {
  // Un Map por final (mes -> producción / mes -> coste real) para no repetir
  // `.find()` dentro del bucle de meses — con hasta ~250 finales × 12 meses no
  // sería un problema de rendimiento real, pero así queda igual de claro y sin
  // el coste extra.
  //
  // El peso NO es la producción de F4111 (`produccionPorMes`, la del gráfico de
  // barras) sino la cantidad producida en las órdenes que generaron el coste
  // (`costeRealPorMes[].cantidad`) — coste y peso salen así de la misma fila y
  // no hay forma de que un mes tenga coste pero peso 0.
  const porFinal = finales.map((f) => ({
    costeA1: f.costeA1,
    costeRealPorMes: new Map((f.costeRealPorMes ?? []).map((p) => [p.mes, p])),
  }));
  return mesesRango.map((mes) => {
    let sumaTeorico = 0;
    let sumaReal = 0;
    let sumaPesos = 0;
    for (const f of porFinal) {
      const punto = f.costeRealPorMes.get(mes);
      const peso = punto?.cantidad ?? 0;
      if (peso <= 0) continue;
      const costeReal = punto?.costeReal ?? null;
      // Misma población en las dos series: sin coste real ese mes, este final
      // tampoco pesa en el Teórico de ese mes (aunque tenga costeA1).
      if (costeReal == null || f.costeA1 == null) continue;
      sumaPesos += peso;
      sumaTeorico += f.costeA1 * peso;
      sumaReal += costeReal * peso;
    }
    return {
      mes,
      teorico: sumaPesos > 0 ? sumaTeorico / sumaPesos : null,
      real: sumaPesos > 0 ? sumaReal / sumaPesos : null,
    };
  });
}

export interface ImpactoArticulo { codigo: string; descripcion: string; impacto: number }

// Impacto económico de la desviación de cada artículo final en el rango:
// (costeReal − costeA1) × cantidad costeada. Misma fórmula y misma población que
// el KPI "Impacto de la desviación" (app/costes/page.tsx), pero por artículo en
// vez de agregada — el gráfico responde a "¿QUIÉN se está comiendo el dinero?",
// que el KPI (un número suelto) no puede contestar.
//
// Devuelve los `n` PEORES (mayor sobrecoste) y los `n` MEJORES (mayor ahorro)
// en dos listas separadas — el gráfico enseña una u otra según la pestaña
// elegida (pedido explícito, igual que se cambia de código en el panel de
// desglose). Antes era un único top por valor absoluto: se perdía una de las
// dos colas cuando todos los desvíos grandes caían del mismo lado.
// Cada lista solo lleva artículos de SU signo (peores = impacto > 0, mejores =
// impacto < 0): sin ese filtro, con un solo artículo (o pocos) un ahorro salía
// en "Mayor sobrecoste", en verde. Al ser de signo opuesto, un artículo nunca
// sale en las dos pestañas; el impacto exactamente 0 no sale en ninguna.
export function extremosImpacto(finales: DespieceNode[], n = 5): { peores: ImpactoArticulo[]; mejores: ImpactoArticulo[] } {
  const conImpacto = finales
    .map((f) => {
      const cantidad = (f.costeRealPorMes ?? []).reduce((s, m) => s + m.cantidad, 0);
      if (f.costeReal == null || f.costeA1 == null || cantidad <= 0) return null;
      return { codigo: f.codigo, descripcion: f.descripcion, impacto: (f.costeReal - f.costeA1) * cantidad };
    })
    .filter((x): x is ImpactoArticulo => x !== null)
    .sort((a, b) => b.impacto - a.impacto);

  const peores = conImpacto.filter((d) => d.impacto > 0).slice(0, n);
  // Los mejores, del mayor ahorro al menor — `slice(-n)` los deja al revés
  // (viene ordenado descendente), así que se invierte para que la primera fila
  // de la pestaña sea siempre la más destacada, igual que en la de sobrecostes.
  const mejores = conImpacto.filter((d) => d.impacto < 0).slice(-n).reverse();
  return { peores, mejores };
}

// --- Exportación a Excel (botón «Exportar» de /costes) ---
//
// Dos funciones puras, una por hoja, para poder comprobar la aritmética sin abrir la
// página. Los costes van a 4 decimales (igual que se calculan), los importes a 2 y la
// desviación a 2; lo que no se puede calcular sale como "" (celda vacía), nunca 0.
const redondear = (v: number | null, dec: number): number | "" =>
  v == null ? "" : Math.round(v * 10 ** dec) / 10 ** dec;

// Hoja «Coste por articulo final» (una fila por final). `CantidadCosteada` es la
// producción de las órdenes que dan el coste real en el rango (suma de
// `costeRealPorMes[].cantidad`), la misma que usa el impacto en € del panel. Importe =
// cantidad × coste; vacío si falta el coste o la cantidad es 0.
export function filaResumenExcel(n: DespieceNode) {
  const cantidad = (n.costeRealPorMes ?? []).reduce((s, m) => s + m.cantidad, 0);
  const importe = (coste: number | null) => (coste != null && cantidad > 0 ? coste * cantidad : null);
  return {
    Codigo: n.codigo,
    Descripcion: n.descripcion,
    Tipo: n.tipo,
    Familia: n.familiaDescripcion,
    CosteA1: redondear(n.costeA1, 4),
    CosteReal: redondear(n.costeReal, 4),
    DesviacionPct: redondear(desviacionPct(n), 2),
    CantidadCosteada: cantidad > 0 ? redondear(cantidad, 3) : "",
    ImporteTeorico: redondear(importe(n.costeA1), 2),
    ImporteReal: redondear(importe(n.costeReal), 2),
  };
}

// Hoja «Despiece completo» (una fila por componente). Aquí `Cantidad` es la del BOM por
// unidad de SU padre directo (no producción), así que `CantidadXCosteA1` / `CantidadXCosteReal`
// son lo que esa línea aporta al coste de una unidad de su padre.
export function filaDetalleExcel(d: DespieceNode & { articuloFinal: string; nivel: number }) {
  const linea = (coste: number | null) => (coste != null ? coste * d.cantidad : null);
  return {
    ArticuloFinal: d.articuloFinal,
    Nivel: d.nivel,
    Codigo: d.codigo,
    Descripcion: d.descripcion,
    Tipo: d.tipo,
    Cantidad: redondear(d.cantidad, 3),
    UM: d.um,
    CosteA1: redondear(d.costeA1, 4),
    CosteReal: redondear(d.costeReal, 4),
    DesviacionPct: redondear(desviacionPct(d), 2),
    CantidadXCosteA1: redondear(linea(d.costeA1), 4),
    CantidadXCosteReal: redondear(linea(d.costeReal), 4),
  };
}


