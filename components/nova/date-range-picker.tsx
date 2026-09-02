"use client";

// Selector de rango de fechas por día (no por mes, a diferencia de MonthRangePicker) —
// mismo input nativo <input type="date"> que /produccion (components/DatePicker.tsx),
// envuelto en el popover con botón+icono de Nova para que encaje visualmente con el
// resto del panel.
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Input } from "@/components/nova/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

export interface DateRange {
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;
}

function labelFecha(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2 font-normal">
            <Calendar size={14} className="text-muted-foreground" />
            <span>{labelFecha(value.startDate)} – {labelFecha(value.endDate)}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-auto">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Desde</span>
            <Input
              type="date"
              value={value.startDate}
              max={value.endDate}
              onChange={(e) => onChange({ ...value, startDate: e.target.value })}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Hasta</span>
            <Input
              type="date"
              value={value.endDate}
              min={value.startDate}
              onChange={(e) => onChange({ ...value, endDate: e.target.value })}
              className="w-40"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
