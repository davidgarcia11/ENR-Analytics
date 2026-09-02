"use client";

// Selector de rango de FECHAS EXACTAS (no meses completos, a diferencia de
// month-range-picker.tsx) — Popover + Calendar en modo "range", mismo componente que
// /produccion-v2 (components/nova/ui/calendar.tsx, react-day-picker).
//
// value=null significa "sin filtro de fechas" (todo el histórico) — es el estado por
// defecto en /muestras: un pendiente no deja de serlo por ser antiguo, así que
// restringir por fecha por defecto escondía pendientes reales. El usuario elige un
// rango explícitamente si quiere acotar, y puede quitarlo con el botón "×".
import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Button } from "@/components/nova/ui/button";
import { Calendar } from "@/components/nova/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange | null;
  onChange: (r: DateRange | null) => void;
}) {
  const today = new Date();
  const from = value ? toDate(value.startDate) : today;
  const to = value ? toDate(value.endDate) : today;
  const label = !value
    ? "Todas las fechas"
    : value.startDate === value.endDate
      ? fmt(from)
      : `${fmt(from)} – ${fmt(to)}`;

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-2 font-normal">
              <CalendarIcon size={14} className="text-muted-foreground" />
              <span>{label}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={from}
            selected={value ? ({ from, to } as DayPickerRange) : undefined}
            onSelect={(r: DayPickerRange | undefined) => {
              if (r?.from) onChange({ startDate: toISO(r.from), endDate: toISO(r.to ?? r.from) });
            }}
          />
        </PopoverContent>
      </Popover>
      {value && (
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} title="Quitar filtro de fechas">
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
