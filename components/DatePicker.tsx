"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { es } from "date-fns/locale"
import { format, parse, isValid } from "date-fns"
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react"

interface DatePickerProps {
  value: string          // YYYY-MM-DD
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = "dd/mm/aaaa", className = "" }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const selected = React.useMemo(() => {
    if (!value) return undefined
    const d = parse(value, "yyyy-MM-dd", new Date())
    return isValid(d) ? d : undefined
  }, [value])

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"))
      setOpen(false)
    }
  }

  const displayValue = selected ? format(selected, "dd/MM/yyyy") : ""

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* Botón que muestra la fecha seleccionada */}
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={`
          flex h-9 w-full items-center justify-between gap-2 rounded-md border
          bg-white px-3 text-sm shadow-sm transition-colors
          ${open ? "border-slate-400 ring-1 ring-slate-200" : "border-gray-200 hover:border-gray-300"}
          ${displayValue ? "text-gray-800 font-medium" : "text-gray-400"}
        `}
      >
        <span>{displayValue || placeholder}</span>
        <Calendar className={`h-3.5 w-3.5 shrink-0 transition-colors ${open ? "text-slate-500" : "text-gray-300"}`} />
      </button>

      {/* Popover con el calendario */}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 rounded-xl border border-gray-200 bg-white shadow-xl p-3 animate-in fade-in-0 zoom-in-95 duration-100">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            locale={es}
            defaultMonth={selected}
            showOutsideDays
            classNames={{
              root:            "w-[248px]",
              months:          "flex flex-col",
              month:           "space-y-3 relative",
              month_caption:   "flex justify-center items-center h-9",
              caption_label:   "text-sm font-semibold text-gray-800 capitalize pointer-events-none",
              nav:             "absolute top-0 inset-x-0 flex justify-between items-center h-9 z-10",
              button_previous: "h-7 w-7 rounded-md border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors",
              button_next:     "h-7 w-7 rounded-md border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors",
              month_grid:      "w-full border-collapse",
              weekdays:        "flex mb-1",
              weekday:         "text-gray-400 font-semibold text-[11px] uppercase tracking-wider w-8 text-center",
              weeks:           "space-y-0.5",
              week:            "flex w-full",
              day:             "relative p-0 text-center",
              day_button:      "h-8 w-8 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors focus:outline-none mx-auto flex items-center justify-center",
              selected:        "[&>button]:!bg-[#D30B15] [&>button]:!text-white [&>button]:hover:!bg-[#b00a12] [&>button]:font-bold",
              today:           "[&>button]:border [&>button]:border-gray-300 [&>button]:font-bold [&>button]:text-gray-900",
              outside:         "[&>button]:text-gray-300",
              disabled:        "[&>button]:text-gray-200 [&>button]:cursor-not-allowed",
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === "left"
                  ? <ChevronLeft  className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />,
            }}
          />
        </div>
      )}
    </div>
  )
}
