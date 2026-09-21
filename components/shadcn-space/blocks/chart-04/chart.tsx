"use client";

// Ocupa el hueco del bloque "Chart 04 - Bar Chart" de ShadcnSpace, que enseñaba
// la PRODUCCIÓN por mes. Sustituido (pedido explícito) por los 5 artículos con
// PEOR impacto € y los 5 con MEJOR impacto del rango. Motivos del cambio, por si alguien recupera la
// versión anterior del historial:
//   - repetía forma (otro gráfico de barras verticales) justo al lado del de
//     coste, sin añadir una lectura nueva;
//   - el dato ya estaba dos veces en pantalla (KPI "Producción total" y columna
//     Producción de la tabla);
//   - la producción sale de F4111, que desde el cambio del coste real ya no es
//     la fuente que pondera el resto del panel (la cantidad de las órdenes
//     costeadas) — dos cifras de "cuánto se produjo" a la vez invitaban a
//     preguntas que no llevaban a nada.
// El de ahora responde "¿QUIÉN se está comiendo el dinero?", que es lo que el
// KPI de impacto (un número agregado) no puede contestar.
//
// YA NO ES UN CHART DE RECHARTS: mismo diseño que `DeviationByFamilyChart` de
// /compras (components/nova/deviation-by-family-chart.tsx) — pedido explícito —,
// o sea divs + Tailwind con barras divergentes desde el centro, sin ejes. Se
// mantiene en esta ruta (y no en components/nova/) para no partir en dos el
// historial del archivo que ocupa esa celda del grid; si algún día molesta,
// mover a components/nova/impacto-articulos-chart.tsx es copiar y pegar.
//
// Diferencia importante de color respecto al de compras: allí positivo (vender
// más de lo previsto) es VERDE; aquí positivo es sobrecoste, o sea ROJO —
// mismos tokens y mismo criterio que DesviacionBadge y los KPI del panel.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { cn } from "@/lib/utils";
import type { ImpactoArticulo } from "@/components/nova/coste-a1-shared";

// Impacto en € con 0 decimales — son importes de rango completo (miles de €),
// los céntimos aquí son ruido. El coste unitario (euros(), 4 decimales) es otra
// cosa y va en el gráfico de al lado y en la tabla.
const impactoEuros = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

export default function Chart04({
  className,
  data,
  onSelect,
}: {
  className?: string;
  data: ImpactoArticulo[];
  onSelect?: (codigo: string) => void;
}) {
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.impacto)), 1);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-medium text-foreground">Artículos por impacto</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">5 mayores sobrecostes y 5 mayores ahorros · € del rango</p>
      </CardHeader>
      {/* flex-1 + justify-between, igual que en compras: la Card se estira a la
          altura del gráfico de coste (grid sin items-start) y las filas se
          reparten el alto disponible en vez de dejar hueco muerto debajo. */}
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        {data.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin artículos con coste real en el rango.</p>
        )}
        {data.map((d, i) => {
          const sobrecoste = d.impacto > 0;
          // Separador entre las dos colas: la lista viene ordenada de mayor
          // sobrecoste a mayor ahorro (extremosImpacto()), así que el corte es
          // el primer artículo que ya no es sobrecoste. Si todos caen del mismo
          // lado no se dibuja ninguno.
          const primerAhorro = !sobrecoste && i > 0 && data[i - 1].impacto > 0;
          // Divergente desde el centro (0): mitad izquierda para los ahorros,
          // mitad derecha para los sobrecostes. Escalado al máximo absoluto de
          // la serie, así que cada mitad vale maxAbs. El mínimo de 3% evita que
          // los últimos del top queden invisibles.
          const anchoMitadPct = Math.max(3, (Math.abs(d.impacto) / maxAbs) * 100);
          return (
            <button
              key={d.codigo}
              type="button"
              onClick={() => onSelect?.(d.codigo)}
              title={d.descripcion || d.codigo}
              // El clic selecciona ese artículo en el panel de desglose: el
              // gráfico señala al culpable y se entra a su despiece sin buscarlo
              // a mano en la tabla. <button> y no <div> para que funcione con
              // teclado y lectores de pantalla.
              className={cn("w-full space-y-1 text-left", primerAhorro && "mt-1 border-t border-border pt-2")}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                {/* Código Y descripción en la misma línea (pedido explícito) —
                    en dos líneas, con 10 filas, la tarjeta se iba de alto. El
                    código no se trunca nunca (`shrink-0`): es lo que se busca
                    para cruzar con JDE; lo que cede es la descripción. */}
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="shrink-0 font-medium text-foreground">{d.codigo}</span>
                  <span className="truncate text-xs text-muted-foreground">{d.descripcion}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-medium",
                    sobrecoste ? "text-[color:var(--color-destructive)]" : "text-[color:var(--color-success)]"
                  )}
                >
                  {impactoEuros(d.impacto)}
                </span>
              </div>
              <div className="relative h-1.5">
                {/* Carril de fondo a ancho completo — da la referencia visual del
                    centro sin necesitar un marcador de 0 aparte. */}
                <div className="absolute inset-0 rounded-full bg-muted" />
                <div className="absolute inset-y-0 left-0 w-1/2 pr-px">
                  {!sobrecoste && (
                    <div
                      className="absolute inset-y-0 right-0 rounded-full bg-[color:var(--color-success)] opacity-80"
                      style={{ width: `${anchoMitadPct}%` }}
                    />
                  )}
                </div>
                <div className="absolute inset-y-0 right-0 w-1/2 pl-px">
                  {sobrecoste && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--color-destructive)] opacity-80"
                      style={{ width: `${anchoMitadPct}%` }}
                    />
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
