"use client";

// Helpers compartidos entre la tabla (coste-a1-table.tsx) y el panel de desglose
// (coste-a1-desglose-panel.tsx) — antes vivían todos dentro de la tabla, cuando el
// desglose era un modal propio de ese archivo; al pasar el desglose a un panel
// aparte (columna derecha) se extraen aquí para no duplicarlos.
import { cn } from "@/lib/utils";
import type { DespieceNode } from "@/app/api/coste-a1/route";

export type { DespieceNode };

// El coste sale de dividir IECSL entre 10000 (F30026) — hasta 4 decimales con
// significado real. Redondear a 2 como el resto de importes de la app perdía
// precisión real (ej. 0,6454 € se veía como 0,65 €), así que aquí se muestran
// todos los decimales que tenga, no solo 2.
export function euros(v: number): string {
  return `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
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
