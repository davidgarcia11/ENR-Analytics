"use client";

// Selector de UNA fecha exacta (a diferencia de date-range-picker.tsx, que es un
// rango) — Popover + Calendar en modo "single", mismos primitivos ya instalados.
// No hay bloque de "date picker" en el catálogo ShadcnSpace (comprobado antes de
// construir esto a mano, ver components/nova/README.md).
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/nova/ui/button";
import { Calendar } from "@/components/nova/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/nova/ui/popover";

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmt(d: Date): string {
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function DatePicker({
  value,
  onChange,
}: {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
}) {
  const date = value ? toDate(value) : undefined;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="w-full justify-between font-normal">
            <span className="flex items-center gap-2">
              <CalendarIcon size={14} className="text-muted-foreground" />
              {date ? fmt(date) : "Seleccionar fecha"}
            </span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          defaultMonth={date}
          selected={date}
          onSelect={(d: Date | undefined) => d && onChange(toISO(d))}
        />
      </PopoverContent>
    </Popover>
  );
}
