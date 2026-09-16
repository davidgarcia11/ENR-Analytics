"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Option {
    id: string
    description: string
}

interface SingleSelectProps {
    options: Option[]
    value: string
    onChange: (value: string) => void
    label?: string
    allLabel?: string
    showId?: boolean
}

export function SingleSelect({
    options,
    value,
    onChange,
    label = "Opción",
    allLabel = "Todas",
    showId = false,
}: SingleSelectProps) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const allOptions: Option[] = [{ id: 'all', description: allLabel }, ...options]

    const filteredOptions = allOptions.filter(opt =>
        opt.id === 'all' ||
        opt.id.toLowerCase().includes(query.toLowerCase()) ||
        opt.description.toLowerCase().includes(query.toLowerCase())
    )

    const selectedOption = allOptions.find(o => o.id === value)

    const handleSelect = (id: string) => {
        onChange(id)
        setOpen(false)
        setQuery("")
    }

    return (
        <div className="relative w-full" ref={containerRef}>
            <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label={`Filtrar por ${label}`}
                onClick={() => setOpen(!open)}
                className="h-9 w-full justify-between border-slate-300 bg-white"
            >
                <div className="flex gap-1 truncate w-full items-center">
                    {value === 'all' ? (
                        <span className="text-slate-500 font-normal">Filtrar por {label}...</span>
                    ) : (
                        <span className="bg-slate-100 text-slate-800 text-xs px-2 py-0.5 rounded-md border border-slate-200 font-medium truncate max-w-[220px]">
                            {selectedOption
                                ? (showId ? `${selectedOption.id} - ${selectedOption.description}` : selectedOption.description)
                                : value}
                        </span>
                    )}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>

            {open && (
                <div className="absolute top-full mt-1 z-50 w-[300px] bg-white border border-slate-200 rounded-md shadow-lg flex flex-col max-h-[400px]">
                    <div className="p-2 border-b border-slate-100 sticky top-0 bg-white z-10">
                        <input
                            className="flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder={`Buscar ${label}...`}
                            aria-label={`Buscar ${label}`}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="overflow-y-auto flex-1 p-1">
                        {filteredOptions.length === 0 ? (
                            <div className="py-6 text-center text-sm text-slate-500">No se encontraron opciones.</div>
                        ) : (
                            filteredOptions.map((opt) => {
                                const isSelected = opt.id === value
                                return (
                                    <div
                                        key={opt.id}
                                        onClick={() => handleSelect(opt.id)}
                                        className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none hover:bg-slate-100 cursor-pointer ${isSelected ? "bg-slate-50 text-slate-900" : "text-slate-700"}`}
                                    >
                                        <div className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300"}`}>
                                            {isSelected && <Check className="h-3 w-3" />}
                                        </div>
                                        <div className="flex flex-col">
                                            {showId && opt.id !== 'all' && (
                                                <span className="font-medium text-xs">{opt.id}</span>
                                            )}
                                            <span className={showId && opt.id !== 'all' ? "text-[10px] text-slate-500 truncate max-w-[220px]" : "font-medium text-xs truncate max-w-[220px]"}>
                                                {opt.description}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
