"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import MermaBreakdown, { MermaCode } from "./MermaBreakdown"

interface MermaCellPopoverProps {
  rowMerma: number
  buildParams: () => URLSearchParams // params con todos los filtros aplicados
  order: string
  productionDateRaw: string | number
  article: string
  // Permite que la celda mantenga su estilo (color) del padre
  className?: string
  cellContent: React.ReactNode
}

// Envuelve la celda de Merma en un popover. Al abrirse, hace fetch del modo 'row'
// del endpoint /api/production/merma-breakdown con los filtros vigentes + parámetros
// específicos de la fila (order, productionDateRaw, article).
export default function MermaCellPopover({
  rowMerma,
  buildParams,
  order,
  productionDateRaw,
  article,
  className,
  cellContent,
}: MermaCellPopoverProps) {
  const [open, setOpen] = useState(false)
  const [codes, setCodes] = useState<MermaCode[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  const handleOpenChange = async (next: boolean) => {
    setOpen(next)
    // Si no hay merma, no merece la pena pedir nada
    if (next && !fetched && Math.abs(rowMerma) > 0) {
      setLoading(true)
      try {
        const params = buildParams()
        params.set('mode', 'row')
        params.set('order', String(order))
        params.set('productionDateRaw', String(productionDateRaw))
        params.set('rowArticle', String(article))
        const res = await fetch(`/api/production/merma-breakdown?${params.toString()}`)
        const json = await res.json()
        setCodes(json.codes || [])
        setTotal(json.total || 0)
        setFetched(true)
      } catch (err) {
        console.error('Error cargando desglose de fila:', err)
      } finally {
        setLoading(false)
      }
    }
  }

  // Si la fila no tiene merma, mostramos la celda sin clic.
  if (Math.abs(rowMerma) <= 0) {
    return <span className={className}>{cellContent}</span>
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${className || ''} cursor-pointer hover:underline decoration-dotted underline-offset-2`}
          title="Ver desglose por tipo de merma"
        >
          {cellContent}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-4" align="end">
        <div className="mb-2">
          <div className="text-xs text-gray-500 font-medium">Desglose de merma</div>
          <div className="text-sm font-bold text-gray-800 font-mono">{article}</div>
        </div>
        <MermaBreakdown codes={codes} total={total} loading={loading} compact />
      </PopoverContent>
    </Popover>
  )
}
