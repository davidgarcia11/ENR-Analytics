"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Article {
    id: string
    description: string
}

interface ArticleMultiSelectProps {
    articles: Article[]
    selected: string[]
    onChange: (selected: string[]) => void
    label?: string
    showId?: boolean // Si false, solo muestra la descripción en el listado
}

export function ArticleMultiSelect({
    articles,
    selected,
    onChange,
    label = "Artículos",
    showId = true,
}: ArticleMultiSelectProps) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const containerRef = React.useRef<HTMLDivElement>(null)

    // Close on click outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const filteredArticles = articles.filter((article) =>
        article.id.toLowerCase().includes(query.toLowerCase()) ||
        article.description.toLowerCase().includes(query.toLowerCase())
    )

    const handleSelect = (articleId: string) => {
        const newSelected = selected.includes(articleId)
            ? selected.filter((id) => id !== articleId)
            : [...selected, articleId]
        onChange(newSelected)
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
                    {selected.length === 0 ? (
                        <span className="text-slate-500 font-normal">Filtrar por {label}...</span>
                    ) : (
                        <div className="flex gap-1 items-center overflow-hidden">
                            <span className="bg-slate-100 text-slate-800 text-xs px-2 py-0.5 rounded-md border border-slate-200 font-medium">
                                {selected.length} seleccionados
                            </span>
                            {selected.length <= 2 && selected.map(id => (
                                <span key={id} className="text-xs text-slate-600 truncate max-w-[50px]">{id}</span>
                            ))}
                        </div>
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
                        <div className="flex gap-1 mt-1.5">
                            <button
                                type="button"
                                aria-label="Seleccionar todos"
                                onClick={() => onChange(Array.from(new Set([...selected, ...filteredArticles.map(a => a.id)])))}
                                className="flex-1 text-xs text-slate-600 hover:text-slate-900 py-1 rounded hover:bg-slate-100 font-medium"
                            >
                                Sel. todos
                            </button>
                            {selected.length > 0 && (
                                <button
                                    type="button"
                                    aria-label="Deseleccionar todos"
                                    onClick={() => onChange([])}
                                    className="flex-1 text-xs text-slate-500 hover:text-red-600 py-1 rounded hover:bg-red-50 font-medium"
                                >
                                    Ninguno
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="overflow-y-auto flex-1 p-1">
                        {filteredArticles.length === 0 ? (
                            <div className="py-6 text-center text-sm text-slate-500">No se encontraron artículos.</div>
                        ) : (
                            filteredArticles.map((article) => {
                                const isSelected = selected.includes(article.id)
                                return (
                                    <div
                                        key={article.id}
                                        onClick={() => handleSelect(article.id)}
                                        className={`
                                    relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none hover:bg-slate-100 cursor-pointer
                                    ${isSelected ? "bg-slate-50 text-slate-900" : "text-slate-700"}
                                `}
                                    >
                                        <div className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300"}`}>
                                            {isSelected && <Check className="h-3 w-3" />}
                                        </div>
                                        <div className="flex flex-col">
                                            {showId && <span className="font-medium text-xs">{article.id}</span>}
                                            <span className={showId ? "text-[10px] text-slate-500 truncate max-w-[220px]" : "font-medium text-xs truncate max-w-[220px]"}>{article.description}</span>
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
