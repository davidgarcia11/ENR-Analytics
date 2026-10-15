"use client";

// Pestaña «Indicadores» de /servicio: sustituye a las tablas dinámicas y al gráfico 3D del
// Excel — resumen mes × canal con % a tiempo / completo / OTIF, evolución del OTIF por
// canal, e incidencias por motivo, por mes y por responsable. Todo se calcula en cliente
// sobre los envíos ya cargados (rango de la página), con lib/servicio.ts.
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/nova/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/nova/ui/table";
import Chart01, { type Chart01Datum } from "@/components/shadcn-space/blocks/chart-01/chart";
import Charts12 from "@/components/shadcn-space/blocks/chart-12/charts-12";
import Charts16, { type Chart16Datum } from "@/components/shadcn-space/blocks/chart-16/charts-16";
import Chart02 from "@/components/shadcn-space/blocks/chart-02/chart";
import { OBJETIVO_OTIF_PCT, contarIncidencias, incidenciasPorMes, resumenMensual, type Kpis } from "@/lib/servicio";
import type { EnvioDto } from "@/components/nova/servicio-table";
import { cn } from "@/lib/utils";

// ponytail: objetivo único del 98 % (Makro, lib/servicio.ts). Carrefour exige el 99 % por cajas — cuando se
// haga la pestaña de penalizaciones, el objetivo pasará a ser por cliente.
const OBJETIVO_PCT = OBJETIVO_OTIF_PCT;

const PALETA = ["var(--color-blue-500)", "var(--color-sky-400)", "var(--color-teal-400)", "var(--color-orange-400)", "var(--color-slate-300)"];

const mesLabel = (mes: string) => mes.split("-").reverse().join("/");
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const num = (n: number) => n.toLocaleString("es-ES");
const hoyIso = () => new Date().toISOString().slice(0, 10);

function Pct({ v }: { v: number | null }) {
  return <span className={cn("tabular-nums", v !== null && v < OBJETIVO_PCT && "font-medium text-destructive")}>{pct(v)}</span>;
}

function Vacio({ texto }: { texto: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{texto}</p>;
}

export default function ServicioIndicadores({ envios }: { envios: EnvioDto[] }) {
  const hoy = hoyIso();
  const canales = useMemo(() => {
    const m = new Map<string, string>();
    envios.forEach((e) => { if (e.canal) m.set(e.canal, e.canalLabel ?? e.canal); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [envios]);
  const etiqueta = (canal: string | null) => (canal ? canales.find(([c]) => c === canal)?.[1] ?? canal : "Sin canal");

  const filas = useMemo(() => resumenMensual(envios, hoy), [envios, hoy]);
  const totales = useMemo(() => new Map(resumenMensual(envios.map((e) => ({ ...e, canal: null })), hoy).map((f) => [f.mes, f.kpis])), [envios, hoy]);
  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))], [filas]);

  // Evolución del OTIF por canal: una serie por canal (claves s0, s1… para no depender del nombre).
  const claveCanal = useMemo(() => new Map([...canales.map(([c]) => c), ""].map((c, i) => [c, `s${i}`])), [canales]);
  const lineas = useMemo(() => meses.map((mes) => {
    const fila: Record<string, string | number | null> = { month: mesLabel(mes) };
    for (const f of filas) if (f.mes === mes) fila[claveCanal.get(f.canal ?? "")!] = f.kpis.pctOtif === null ? null : Math.round(f.kpis.pctOtif * 10) / 10;
    return fila;
  }), [meses, filas, claveCanal]);
  const nombresSeries = [...canales.map(([, l]) => l), ...(envios.some((e) => !e.canal) ? ["Sin canal"] : [])];

  const porMotivo = useMemo(() => Object.entries(contarIncidencias(envios, "motivo")).sort((a, b) => b[1] - a[1]), [envios]);
  const principales = useMemo(() => porMotivo.slice(0, 4).map(([m]) => m), [porMotivo]);
  const hayResto = porMotivo.length > principales.length;
  const barrasMotivo = useMemo(() => {
    const top = porMotivo.slice(0, 4).map(([label, value]) => ({ label, value }));
    const resto = porMotivo.slice(4).reduce((t, [, n]) => t + n, 0);
    return resto > 0 ? [...top, { label: "Otros motivos", value: resto }] : top;
  }, [porMotivo]);
  const motivosApilados = useMemo(() => (hayResto ? [...principales, "Otros motivos"] : principales), [principales, hayResto]);
  const apiladas = useMemo(() => incidenciasPorMes(envios).map((f) => {
    const o: Record<string, string | number> = { month: mesLabel(String(f.mes)) };
    principales.forEach((m, i) => { o[`s${i}`] = (f[m] as number) ?? 0; });
    if (hayResto) o[`s${principales.length}`] = Object.entries(f).filter(([k]) => k !== "mes" && !principales.includes(k)).reduce((t, [, v]) => t + (v as number), 0);
    return o;
  }), [envios, principales, hayResto]);

  // Responsabilidad de los últimos 3 meses con datos (el mes más reciente y los dos anteriores).
  const responsables = useMemo(() => {
    const ultimo = envios.map((e) => e.fechaPrometida?.slice(0, 7) ?? "").sort().pop();
    if (!ultimo) return [];
    const [y, m] = ultimo.split("-").map(Number);
    const desde = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 7);
    return Object.entries(contarIncidencias(envios.filter((e) => (e.fechaPrometida?.slice(0, 7) ?? "") >= desde), "responsable")).sort((a, b) => b[1] - a[1]);
  }, [envios]);

  const kpiCelda = (k: Kpis) => (
    <>
      <TableCell className="px-4 text-right tabular-nums">{k.pedidos}</TableCell>
      <TableCell className="px-4 text-right"><Pct v={k.pctATiempo} /></TableCell>
      <TableCell className="px-4 text-right"><Pct v={k.pctCompleto} /></TableCell>
      <TableCell className="px-4 text-right"><Pct v={k.pctOtif} /></TableCell>
      <TableCell className="px-4 text-right tabular-nums">{num(k.udsPedidas)}</TableCell>
      <TableCell className="px-4 text-right tabular-nums">{num(k.udsIncidencia)}</TableCell>
      <TableCell className="px-4 text-right"><Pct v={k.pctOtifUds} /></TableCell>
      <TableCell className="px-4 text-right"><Pct v={k.pctOtifCajas} /></TableCell>
      <TableCell className="px-4 text-right text-muted-foreground">{pct(k.cobertura)}</TableCell>
    </>
  );
  const th = "h-9 bg-muted/40 px-4 text-right text-muted-foreground";

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="text-lg font-medium text-foreground">Resumen por mes y canal</CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            Por mes de la fecha prometida. En rojo, por debajo del {OBJETIVO_PCT} %. OTIF en unidades (o cajas) = 1 − (no enviadas + afectadas) / pedidas. Cobertura = pedidos con entrega confirmada: si es baja, el % a tiempo y el OTIF se apoyan en pocos datos.
          </p>
        </CardHeader>
        <CardContent className="overflow-hidden rounded-b-xl border-t border-border p-0">
          {filas.length === 0 ? <Vacio texto="Sin pedidos en el rango seleccionado." /> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60">
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Mes</TableHead>
                    <TableHead className="h-9 bg-muted/40 px-4 text-muted-foreground">Canal</TableHead>
                    <TableHead className={th}>Pedidos</TableHead>
                    <TableHead className={th}>% A tiempo</TableHead>
                    <TableHead className={th}>% Completo</TableHead>
                    <TableHead className={th}>% OTIF pedido</TableHead>
                    <TableHead className={th}>Uds pedidas</TableHead>
                    <TableHead className={th}>Uds con incidencia</TableHead>
                    <TableHead className={th}>% OTIF uds</TableHead>
                    <TableHead className={th}>% OTIF cajas</TableHead>
                    <TableHead className={th}>Cobertura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meses.map((mes) => (
                    <MesRows key={mes} mes={mes} filas={filas.filter((f) => f.mes === mes)} total={totales.get(mes)!} etiqueta={etiqueta} kpiCelda={kpiCelda} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {lineas.length === 0 ? (
        <Card><CardContent><Vacio texto="Sin datos." /></CardContent></Card>
      ) : (
        <Charts16
          title="% OTIF por pedido"
          description={`Evolución por canal · línea discontinua: objetivo del ${OBJETIVO_PCT} %`}
          data={lineas as Chart16Datum[]}
          series={nombresSeries.map((label, i) => ({ key: `s${i}`, label, color: PALETA[i % PALETA.length] }))}
          objetivo={OBJETIVO_PCT}
          domain={[Math.floor(Math.min(...lineas.flatMap((l) => Object.entries(l).filter(([k, v]) => k !== "month" && typeof v === "number").map(([, v]) => v as number)), 90) / 10) * 10, 100]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {porMotivo.length === 0 ? (
          <Card className="py-6 gap-8 rounded-2xl shadow-none">
            <CardHeader className="px-6"><CardTitle className="text-lg font-medium">Incidencias por motivo</CardTitle></CardHeader>
            <CardContent><Vacio texto="Sin incidencias anotadas." /></CardContent>
          </Card>
        ) : (
          <Charts12
            className="gap-6 rounded-2xl px-6 py-6 shadow-none"
            title="Incidencias por motivo"
            description="Envíos con motivo anotado, en el rango seleccionado"
            serieLabel="Incidencias"
            data={barrasMotivo}
          />
        )}

        {responsables.length === 0 ? (
          <Card className="py-6 gap-8 shadow-xs"><CardHeader className="px-6"><CardTitle className="text-lg font-medium">Responsabilidad — últimos 3 meses</CardTitle></CardHeader><CardContent><Vacio texto="Sin incidencias anotadas." /></CardContent></Card>
        ) : (
          <Chart02
            title="Responsabilidad — últimos 3 meses"
            description="Incidencias por responsable (el mes más reciente con datos y los 2 anteriores)"
            centerLabel="Incidencias"
            data={responsables.map(([name, value], i) => ({ name, value, color: PALETA[i % PALETA.length] }))}
          />
        )}
      </div>

      {apiladas.length === 0 ? (
        <Card><CardContent><Vacio texto="Sin incidencias anotadas." /></CardContent></Card>
      ) : (
        <Chart01
          title="Incidencias por mes y motivo"
          headline={String(porMotivo.reduce((s, [, n]) => s + n, 0))}
          description="incidencias en el rango"
          data={apiladas as Chart01Datum[]}
          series={motivosApilados.map((label, i) => ({ key: `s${i}`, label, color: PALETA[i % PALETA.length] }))}
        />
      )}
    </div>
  );
}

function MesRows({ mes, filas, total, etiqueta, kpiCelda }: {
  mes: string;
  filas: { canal: string | null; kpis: Kpis }[];
  total: Kpis;
  etiqueta: (c: string | null) => string;
  kpiCelda: (k: Kpis) => React.ReactNode;
}) {
  return (
    <>
      {filas.map((f, i) => (
        <TableRow key={f.canal ?? "_"} className="h-10 border-border/60">
          <TableCell className="px-4 font-medium text-foreground">{i === 0 ? mesLabel(mes) : ""}</TableCell>
          <TableCell className="px-4 text-muted-foreground">{etiqueta(f.canal)}</TableCell>
          {kpiCelda(f.kpis)}
        </TableRow>
      ))}
      <TableRow className="h-10 border-border/60 bg-muted/30 font-medium">
        <TableCell className="px-4" colSpan={2}>Total {mesLabel(mes)}</TableCell>
        {kpiCelda(total)}
      </TableRow>
    </>
  );
}
