"use client"

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function DatePicker({ value, onChange, className = "" }: DatePickerProps) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`h-9 rounded-md border border-gray-200 bg-white px-3 text-sm shadow-sm transition-colors hover:border-gray-300 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-200 ${className}`}
    />
  )
}
