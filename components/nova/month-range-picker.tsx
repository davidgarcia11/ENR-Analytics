"use client";

import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

const MES_LABEL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

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

export interface MonthRange {
  startDate: string; // 'YYYY-MM-DD', primer día del mes "desde"
  endDate: string; // 'YYYY-MM-DD', último día del mes "hasta"
}

// Selección por meses completos (nunca por día) — usa <input type="month"> nativo en
// vez de un calendario día a día, que no hace falta para este filtro.
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

  const handleDesde = (month: string) => {
    if (!month) return;
    onChange({
      startDate: firstDayOfMonth(month),
      endDate: month > hasta ? lastDayOfMonth(month) : value.endDate,
    });
  };
  const handleHasta = (month: string) => {
    if (!month) return;
    onChange({
      startDate: month < desde ? firstDayOfMonth(month) : value.startDate,
      endDate: lastDayOfMonth(month),
    });
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
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Desde
            <input
              type="month"
              value={desde}
              onChange={(e) => handleDesde(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hasta
            <input
              type="month"
              value={hasta}
              onChange={(e) => handleHasta(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
