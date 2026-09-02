"use client";

// Selector de rango de FECHAS EXACTAS (no meses completos, a diferencia de
// month-range-picker.tsx) — Popover + Calendar en modo "range", mismo componente que
// /produccion-v2 (components/nova/ui/calendar.tsx, react-day-picker). Antes era un
// popover con dos <input type="date">; ahora es el calendario real, para que ambos
// paneles se vean y se comporten igual.
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
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
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const from = toDate(value.startDate);
  const to = toDate(value.endDate);
  const label = value.startDate === value.endDate ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;

  return (
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
          selected={{ from, to } as DayPickerRange}
          onSelect={(r: DayPickerRange | undefined) => {
            if (r?.from) onChange({ startDate: toISO(r.from), endDate: toISO(r.to ?? r.from) });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
