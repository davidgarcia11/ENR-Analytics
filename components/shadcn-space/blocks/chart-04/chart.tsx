"use client";

// Bloque "Chart 04 - Bar Chart" de ShadcnSpace, adaptado a datos reales (mismo
// patrón que chart-15/charts-15.tsx en /compras: se edita el archivo instalado
// en el sitio). Sin el desplegable "Weekly/Monthly/Yearly" del original ni la
// tarjeta KPI "$96,850 -5%".
//
// Enseñaba la PRODUCCIÓN por mes; sustituido (pedido explícito) por el "Top 10
// artículos por impacto €" del rango. Motivos, por si alguien recupera la
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";
import type { ImpactoArticulo } from "@/components/nova/coste-a1-shared";

// Impacto en € con 0 decimales — son importes de rango completo (miles de €),
// los céntimos aquí son ruido. El coste unitario (euros(), 4 decimales) es otra
// cosa y va en el gráfico de al lado y en la tabla.
const impactoEuros = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

const CustomTooltip = ({ active, payload }: TooltipContentProps) => {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload as ImpactoArticulo;
  return (
    <div className="rounded-lg bg-[#1f2937] px-3 py-2 text-white shadow-lg">
      <p className="text-sm font-semibold">{d.codigo}</p>
      {d.descripcion && <p className="mb-1 max-w-[220px] text-xs text-white/70">{d.descripcion}</p>}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-white/70">Impacto:</span>
        <span className="font-semibold text-white">{impactoEuros(d.impacto)}</span>
      </div>
    </div>
  );
};

export default function Chart04({
  className,
  data,
  onSelect,
}: {
  className?: string;
  data: ImpactoArticulo[];
  onSelect?: (codigo: string) => void;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1">
        <CardTitle className="text-lg font-medium text-foreground">Top artículos por impacto</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">Desviación en € del rango, artículos filtrados</p>
      </CardHeader>
      <CardContent>
        {/* Barras HORIZONTALES (`layout="vertical"` en recharts, que nombra el
            layout por el eje de categorías): con 10 artículos y códigos de 10
            dígitos, en vertical las etiquetas del eje X se solaparían o habría
            que girarlas. El eje de valores va oculto — la cifra exacta está en
            el tooltip y lo que importa de un vistazo es el ORDEN y el tamaño
            relativo, no leer el importe en el eje. */}
        <ResponsiveContainer width="100%" height={253}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="codigo"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fontWeight: 400 }}
              width={82}
            />
            <Tooltip cursor={{ fill: "transparent" }} content={CustomTooltip} />
            {/* Color por signo, mismos tokens que DesviacionBadge y los KPI:
                positivo = sobrecoste (destructive), negativo = ahorro (success).
                `onClick` selecciona ese artículo en el panel de desglose — el
                gráfico señala al culpable y de ahí se entra a ver su despiece
                sin buscarlo a mano en la tabla. */}
            <Bar
              dataKey="impacto"
              radius={[0, 4, 4, 0]}
              barSize={14}
              onClick={(d: unknown) => onSelect?.((d as ImpactoArticulo).codigo)}
              className={onSelect ? "cursor-pointer" : undefined}
            >
              {data.map((d) => (
                <Cell
                  key={d.codigo}
                  fill={d.impacto > 0 ? "var(--color-destructive)" : "var(--color-success)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
