"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { es } from "date-fns/locale"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      locale={es}
      showOutsideDays={showOutsideDays}
      className={cn("w-[248px] p-3", className)}
      classNames={{
        months:          "flex flex-col",
        month:           "space-y-3 relative",
        month_caption:   "flex justify-center items-center h-9",
        caption_label:   "text-sm font-semibold text-gray-800 capitalize pointer-events-none",
        nav:             "absolute top-3 inset-x-3 flex justify-between items-center h-9 z-10",
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
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left"
            ? <ChevronLeft className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
