"use client";

// Ocupa el hueco del bloque "Chart 04 - Bar Chart" de ShadcnSpace, que enseñaba
// la PRODUCCIÓN por mes. Sustituido (pedido explícito) por los artículos con
// mayor impacto € del rango. Motivos del cambio, por si alguien recupera la
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
// YA NO ES UN CHART DE RECHARTS: diseño calcado de `DeviationByFamilyChart` de
// /compras (components/nova/deviation-by-family-chart.tsx) — pedido explícito —,
// o sea filas de divs + Tailwind con una barra de progreso, sin ejes. Se
// mantiene en esta ruta (y no en components/nova/) para no partir en dos el
// historial del archivo que ocupa esa celda del grid; si algún día molesta,
// mover a components/nova/impacto-articulos-chart.tsx es copiar y pegar.
//
// SELECTOR de dos pestañas (`AnimatedTabs`, `tabs-08`) para cambiar entre los 5
// de mayor sobrecoste y los 5 de mayor ahorro — pedido explícito, "como cambio
// para ver los componentes de los 11 y 10 de un artículo": mismo componente y
// mismo gesto que el selector del panel de desglose, para no inventar un patrón
// nuevo dentro del mismo panel. Al enseñar una sola cola por pestaña, las
// barras crecen desde la izquierda (todas del mismo signo) en vez de divergir
// desde el centro, que es lo que tenía sentido cuando las dos colas convivían
// en la misma lista.
//
// Diferencia de color respecto al de compras: allí positivo (vender más de lo
// previsto) es VERDE; aquí positivo es sobrecoste, o sea ROJO — mismos tokens y
// mismo criterio que DesviacionBadge y los KPI del panel.
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { AnimatedTabs, type AnimatedTabItem } from "@/components/shadcn-space/tabs/tabs-08";
import { cn } from "@/lib/utils";
import type { ImpactoArticulo } from "@/components/nova/coste-a1-shared";

// Impacto en € con 0 decimales — son importes de rango completo (miles de €),
// los céntimos aquí son ruido. El coste unitario (euros(), 4 decimales) es otra
// cosa y va en el gráfico de al lado y en la tabla.
const impactoEuros = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

function ListaImpacto({
  items,
  onSelect,
  vacio,
}: {
  items: ImpactoArticulo[];
  onSelect?: (codigo: string) => void;
  vacio: string;
}) {
  // Escala propia de cada pestaña: dentro de una cola los importes son del
  // mismo orden de magnitud, y compartir escala con la otra dejaría la pestaña
  // "pequeña" con todas las barras al mínimo.
  const maxAbs = Math.max(...items.map((d) => Math.abs(d.impacto)), 1);
  if (items.length === 0) return <p className="py-6 text-sm text-muted-foreground">{vacio}</p>;
  return (
    <div className="flex flex-col gap-3">
      {items.map((d) => {
        const sobrecoste = d.impacto > 0;
        // Mínimo del 3% para que la última fila de la lista no quede invisible.
        const ancho = Math.max(3, (Math.abs(d.impacto) / maxAbs) * 100);
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
            className="w-full space-y-1 text-left"
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              {/* Código Y descripción en la misma línea (pedido explícito) — en
                  dos líneas la tarjeta se iba de alto. El código no se trunca
                  nunca (`shrink-0`): es lo que se busca para cruzar con JDE; lo
                  que cede es la descripción. */}
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
              <div className="absolute inset-0 rounded-full bg-muted" />
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full opacity-80",
                  sobrecoste ? "bg-[color:var(--color-destructive)]" : "bg-[color:var(--color-success)]"
                )}
                style={{ width: `${ancho}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function Chart04({
  className,
  data,
  onSelect,
}: {
  className?: string;
  data: { peores: ImpactoArticulo[]; mejores: ImpactoArticulo[] };
  onSelect?: (codigo: string) => void;
}) {
  const tabs = useMemo<AnimatedTabItem[]>(
    () => [
      {
        value: "sobrecoste",
        label: "Mayor sobrecoste",
        content: (
          <ListaImpacto items={data.peores} onSelect={onSelect} vacio="Sin artículos con coste real en el rango." />
        ),
      },
      {
        value: "ahorro",
        label: "Mayor ahorro",
        content: (
          <ListaImpacto items={data.mejores} onSelect={onSelect} vacio="Ningún artículo por debajo de su coste teórico." />
        ),
      },
    ],
    [data, onSelect]
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-medium text-foreground">Artículos por impacto</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">Desviación en € del rango · artículos filtrados</p>
      </CardHeader>
      {/* Sin `flex-1` ni `h-full`: esta tarjeta mide LO QUE MIDE SU CONTENIDO
          (pedido explícito, "que no haya espacio hacia abajo") y es la que
          marca el alto de la fila; la de coste es la que se adapta a ella. */}
      <CardContent className="flex flex-col">
        {/* `sm:w-full` anula el `sm:w-fit` con el que `tabs-08` deja el selector
            del ancho de sus etiquetas (pedido explícito: que ocupe todo el
            ancho de la tarjeta), y `*:flex-1` reparte las dos pestañas a
            partes iguales en vez de dejarlas pegadas a la izquierda. */}
        <AnimatedTabs tabs={tabs} listClassName="sm:w-full *:flex-1" />
      </CardContent>
    </Card>
  );
}
