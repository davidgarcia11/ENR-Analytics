"use client"

import * as React from "react"
import { format, parse, isValid } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  value: string                       // YYYY-MM-DD o ''
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, placeholder = "dd/mm/aaaa", className = "" }: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selected = React.useMemo(() => {
    if (!value) return undefined
    const d = parse(value, "yyyy-MM-dd", new Date())
    return isValid(d) ? d : undefined
  }, [value])

  const handleSelect = (day: Date | undefined) => {
    onChange(day ? format(day, "yyyy-MM-dd") : "")
    setOpen(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange("")
    setOpen(false)
  }

  const displayValue = selected ? format(selected, "dd/MM/yyyy") : ""

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm shadow-sm transition-colors",
            open ? "border-slate-400 ring-1 ring-slate-200" : "border-gray-200 hover:border-gray-300",
            displayValue ? "text-gray-800 font-medium" : "text-gray-400",
            className
          )}
        >
          <span>{displayValue || placeholder}</span>
          <div className="flex items-center gap-1 shrink-0">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={e => e.key === "Enter" && handleClear(e as any)}
                className="flex items-center justify-center text-gray-300 hover:text-gray-500 transition-colors cursor-pointer rounded"
                aria-label="Limpiar fecha"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <CalendarIcon className={cn("h-3.5 w-3.5 transition-colors", open ? "text-slate-500" : "text-gray-300")} />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected}
          showOutsideDays
        />
      </PopoverContent>
    </Popover>
  )
}
