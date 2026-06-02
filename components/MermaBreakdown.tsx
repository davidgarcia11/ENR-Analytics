"use client"

import { Loader2, Tag, Thermometer, MoreHorizontal } from "lucide-react"

export interface MermaCode {
  code: string
  description: string
  group: 'Q' | 'P' | 'O'
  qty: number
  percent: number
}

interface MermaBreakdownProps {
  codes: MermaCode[]
  total: number
  loading?: boolean
  emptyMessage?: string
  compact?: boolean // versión reducida (para popover de fila)
}

// Componente reutilizable que muestra el desglose de merma agrupado por:
//   Etiquetado (códigos Q*) y Pasteurizado (códigos P*)
// Se usa en la card global (debajo de los KPIs) y en el popover por fila.
export default function MermaBreakdown({ codes, total, loading, emptyMessage, compact }: MermaBreakdownProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    )
  }

  if (!codes || codes.length === 0) {
    return (
      <div className="text-center text-gray-500 text-sm py-4">
        {emptyMessage || 'No hay merma registrada en el filtro actual.'}
      </div>
    )
  }

  const calidad = codes.filter(c => c.group === 'Q').sort((a, b) => b.qty - a.qty)
  const proceso = codes.filter(c => c.group === 'P').sort((a, b) => b.qty - a.qty)
  const otros = codes.filter(c => c.group !== 'Q' && c.group !== 'P').sort((a, b) => b.qty - a.qty)

  const sumQty = (list: MermaCode[]) => list.reduce((s, c) => s + c.qty, 0)
  const calidadTotal = sumQty(calidad)
  const procesoTotal = sumQty(proceso)
  const otrosTotal = sumQty(otros)

  const fmtQty = (n: number) => Math.round(n).toLocaleString('es-ES')
  const fmtPct = (p: number) => `${p.toFixed(2)}%`

  return (
    <div className={compact ? 'space-y-3' : 'grid gap-4 md:grid-cols-2'}>
      <BreakdownBlock
        title="Etiquetado (Q)"
        icon={<Tag className="h-4 w-4 text-blue-600" />}
        items={calidad}
        subtotal={calidadTotal}
        total={total}
        fmtQty={fmtQty}
        fmtPct={fmtPct}
        compact={compact}
      />
      <BreakdownBlock
        title="Pasteurizado (P)"
        icon={<Thermometer className="h-4 w-4 text-amber-600" />}
        items={proceso}
        subtotal={procesoTotal}
        total={total}
        fmtQty={fmtQty}
        fmtPct={fmtPct}
        compact={compact}
      />
      {otros.length > 0 && (
        <BreakdownBlock
          title="Otros"
          icon={<MoreHorizontal className="h-4 w-4 text-slate-500" />}
          items={otros}
          subtotal={otrosTotal}
          total={total}
          fmtQty={fmtQty}
          fmtPct={fmtPct}
          compact={compact}
        />
      )}
    </div>
  )
}

interface BlockProps {
  title: string
  icon: React.ReactNode
  items: MermaCode[]
  subtotal: number
  total: number
  fmtQty: (n: number) => string
  fmtPct: (p: number) => string
  compact?: boolean
}

function BreakdownBlock({ title, icon, items, subtotal, total, fmtQty, fmtPct, compact }: BlockProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <h4 className="text-sm font-bold text-gray-700">{title}</h4>
        </div>
        <div className="text-xs text-gray-400">Sin datos</div>
      </div>
    )
  }

  const subtotalPct = total > 0 ? (subtotal / total) * 100 : 0

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <h4 className="text-sm font-bold text-gray-700">{title}</h4>
        </div>
        <div className="text-right">
          <div className="text-sm font-black text-gray-900">{fmtQty(subtotal)}</div>
          <div className="text-[10px] text-gray-500">{fmtPct(subtotalPct)} sobre merma</div>
        </div>
      </div>
      <div className="space-y-1">
        {items.map(item => (
          <div key={item.code} className="flex items-center justify-between text-xs">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">
                  {item.code}
                </span>
                <span className={`text-gray-600 truncate ${compact ? 'max-w-[180px]' : ''}`} title={item.description}>
                  {item.description || '—'}
                </span>
              </div>
            </div>
            <div className="text-right whitespace-nowrap ml-3">
              <span className="font-semibold text-gray-900">{fmtQty(item.qty)}</span>
              <span className="text-gray-400 ml-2 text-[10px]">{fmtPct(item.percent)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
