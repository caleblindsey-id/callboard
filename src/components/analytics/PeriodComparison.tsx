'use client'

import type { TechRow } from '@/lib/db/analytics'

interface PeriodComparisonProps {
  current: TechRow
  prior: TechRow
  yoy: TechRow | null
}

type Row = {
  label: string
  currentVal: number | null
  priorVal: number | null
  yoyVal: number | null
  format: 'currency' | 'number' | 'days' | 'hours'
  invertDelta?: boolean
}

function fmt(val: number | null, format: string): string {
  if (val == null) return '—'
  switch (format) {
    case 'currency': return `$${val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'days': return `${val.toFixed(1)}d`
    case 'hours': return val.toFixed(1)
    default: return val.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}

function delta(current: number | null, prior: number | null): string {
  if (current == null || prior == null || prior === 0) return '—'
  const pct = ((current - prior) / Math.abs(prior)) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

function deltaColor(current: number | null, prior: number | null, invert = false): string {
  if (current == null || prior == null) return 'text-gray-400'
  const diff = current - prior
  if (diff === 0) return 'text-gray-500'
  const positive = invert ? diff < 0 : diff > 0
  return positive ? 'text-green-600' : 'text-red-500'
}

export default function PeriodComparison({ current, prior, yoy }: PeriodComparisonProps) {
  const rows: Row[] = [
    { label: 'Tickets', currentVal: current.ticketsCompleted, priorVal: prior.ticketsCompleted, yoyVal: yoy?.ticketsCompleted ?? null, format: 'number' },
    { label: 'Revenue', currentVal: current.revenue, priorVal: prior.revenue, yoyVal: yoy?.revenue ?? null, format: 'currency' },
    { label: 'Gross Profit', currentVal: current.grossProfit, priorVal: prior.grossProfit, yoyVal: yoy?.grossProfit ?? null, format: 'currency' },
    { label: 'Hours', currentVal: current.totalHours, priorVal: prior.totalHours, yoyVal: yoy?.totalHours ?? null, format: 'hours' },
    { label: 'Avg Completion', currentVal: current.avgCompletionDays, priorVal: prior.avgCompletionDays, yoyVal: yoy?.avgCompletionDays ?? null, format: 'days', invertDelta: true },
  ]

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Period Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Metric</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">This Period</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Last Period</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">MoM</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Same Period LY</th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">YoY</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-5 py-2.5 font-medium text-gray-900">{row.label}</td>
                <td className="px-3 py-2.5 text-right text-gray-900">{fmt(row.currentVal, row.format)}</td>
                <td className="px-3 py-2.5 text-right text-gray-500">{fmt(row.priorVal, row.format)}</td>
                <td className={`px-3 py-2.5 text-right font-medium ${deltaColor(row.currentVal, row.priorVal, row.invertDelta)}`}>
                  {delta(row.currentVal, row.priorVal)}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-500">{fmt(row.yoyVal, row.format)}</td>
                <td className={`px-5 py-2.5 text-right font-medium ${deltaColor(row.currentVal, row.yoyVal, row.invertDelta)}`}>
                  {delta(row.currentVal, row.yoyVal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
