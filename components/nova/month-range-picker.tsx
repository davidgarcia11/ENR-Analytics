"use client";

import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/nova/ui/select";

const MES_LABEL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MES_NOMBRE = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function toMonthInput(dateStr: string) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

function firstDayOfMonth(month: string) {
  return `${month}-01`;
}

function lastDayOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function labelMes(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MES_LABEL[m - 1]} ${y}`;
}

// Años seleccionables en los desplegables — rango fijo alrededor del año actual,
// suficiente para un panel de previsión de compras (no hace falta cubrir décadas).
function anosSeleccionables(): number[] {
  const actual = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => actual - 3 + i);
}

export interface MonthRange {
  startDate: string; // 'YYYY-MM-DD', primer día del mes "desde"
  endDate: string; // 'YYYY-MM-DD', último día del mes "hasta"
}

// Selección por meses completos (nunca por día) — dos desplegables (mes + año) por
// extremo, con los componentes propios del sistema de diseño. Se descartó
// <input type="month"> nativo: el calendario que abre el navegador (en inglés, con su
// propio estilo) desentona por completo con el resto del panel.
export default function MonthRangePicker({
  value,
  onChange,
}: {
  value: MonthRange;
  onChange: (next: MonthRange) => void;
}) {
  const desde = toMonthInput(value.startDate);
  const hasta = toMonthInput(value.endDate);
  const label = desde === hasta ? labelMes(desde) : `${labelMes(desde)} – ${labelMes(hasta)}`;
  const anos = anosSeleccionables();

  const handleDesde = (month: string) => {
    onChange({
      startDate: firstDayOfMonth(month),
      endDate: month > hasta ? lastDayOfMonth(month) : value.endDate,
    });
  };
  const handleHasta = (month: string) => {
    onChange({
      startDate: month < desde ? firstDayOfMonth(month) : value.startDate,
      endDate: lastDayOfMonth(month),
    });
  };

  const selector = (mesActual: string, onMonth: (m: string) => void) => {
    const [anio, mes] = mesActual.split("-");
    return (
      <div className="flex items-center gap-1.5">
        <Select value={mes} onValueChange={(m) => onMonth(`${anio}-${m}`)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MES_NOMBRE.map((nombre, i) => (
              <SelectItem key={nombre} value={String(i + 1).padStart(2, "0")}>
                {nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={anio} onValueChange={(a) => onMonth(`${a}-${mes}`)}>
          <SelectTrigger className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anos.map((a) => (
              <SelectItem key={a} value={String(a)}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <Calendar size={14} className="text-muted-foreground" />
            <span>{label}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-auto">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Desde</span>
            {selector(desde, handleDesde)}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hasta</span>
            {selector(hasta, handleHasta)}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
