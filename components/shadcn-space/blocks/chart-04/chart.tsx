"use client";

// Bloque "Chart 04 - Bar Chart" de ShadcnSpace, adaptado a datos reales (mismo
// patrón que chart-15/charts-15.tsx en /compras: se edita el archivo instalado
// en el sitio). Sin el desplegable "Weekly/Monthly/Yearly" del original — el
// rango ya lo controla el `MonthRangePicker` del propio panel, un segundo
// selector aquí sería redundante — ni la tarjeta KPI "$96,850 -5%" (no hay un
// periodo anterior con el que comparar la producción de forma automática).
// Tampoco se resalta ninguna barra en concreto (el original marcaba un día fijo
// por índice, `index === 1`) — aquí no hay un mes "de referencia" obvio.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";

export interface ProduccionMensualDatum {
  mes: string; // etiqueta ya formateada para el eje X (ej. "ene 26")
  produccion: number;
}

const CustomTooltip = ({ active, payload, label }: TooltipContentProps) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg bg-[#1f2937] px-3 py-2 text-white shadow-lg">
      <p className="mb-1 text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
        <span className="text-white/70">Producción:</span>
        <span className="font-semibold text-white">
          {typeof payload[0].value === "number" ? payload[0].value.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : payload[0].value}
        </span>
      </div>
    </div>
  );
};

export default function Chart04({
  className,
  data,
}: {
  className?: string;
  data: ProduccionMensualDatum[];
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1">
        <CardTitle className="text-lg font-medium text-foreground">Producción</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">Por mes, artículos filtrados</p>
      </CardHeader>
      {/* CardContent (con su padding horizontal normal) en vez del `-me-3
          rtl:...` del bloque original — ese hack de márgenes negativos
          compensaba el `p-6` que el DEMO del catálogo aplica al `<Card>`
          entero desde fuera (`className="max-w-sm ... p-6 ..."` en su
          `page.tsx`); aquí el Card no lleva ese padding exterior, así que
          el mismo hack solo desequilibraba las barras hacia la derecha
          ("más centrado" — pedido explícito tras verlo). Con `CardContent`
          (mismo padding que ya usa el resto del panel) las barras quedan
          centradas de verdad. */}
      <CardContent>
        <ResponsiveContainer width="100%" height={253}>
          <BarChart data={data} barSize={32} barGap={0} barCategoryGap="30%" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 400 }} tickMargin={8} />
            <YAxis hide />
            <Tooltip cursor={{ fill: "transparent" }} content={CustomTooltip} />
            {/* radius alto en las 4 esquinas de una barra estrecha (32px) =
                cápsula/píldora completa, no un rectángulo redondeado — pedido
                explícito con captura de referencia (bloque original de
                ShadcnSpace, `radius={[40,40,40,40]}`). Un solo color para
                todas las barras (sin resaltar ninguna) — pedido explícito,
                "me da igual que sean azules todos". */}
            <Bar dataKey="produccion" radius={[40, 40, 40, 40]} fill="var(--color-blue-500)" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
