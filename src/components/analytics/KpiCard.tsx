'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type Format = 'number' | 'currency' | 'days' | 'percent' | 'hours'

interface KpiCardProps {
  label: string
  value: number | null
  format: Format
  delta?: number | null
  deltaLabel?: string
  invertDelta?: boolean // true = lower is better (e.g., completion days)
  target?: number | null
  targetPercent?: number | null
  subtitle?: string
}

function formatValue(value: number | null, format: Format): string {
  if (value == null) return '—'
  switch (format) {
    case 'currency':
      return value >= 1000
        ? `$${(value / 1000).toFixed(1)}k`
        : `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'days':
      return `${value.toFixed(1)}d`
    case 'percent':
      return `${(value * 100).toFixed(0)}%`
    case 'hours':
      return value.toFixed(1)
    default:
      return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  }
}

function getDeltaColor(delta: number, invert: boolean): string {
  if (delta === 0) return 'text-gray-500'
  const positive = invert ? delta < 0 : delta > 0
  return positive ? 'text-green-600' : 'text-red-500'
}

function getTargetBadge(percent: number): { bg: string; text: string; label: string } {
  if (percent >= 100) return { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300', label: `${percent.toFixed(0)}%` }
  if (percent >= 70) return { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300', label: `${percent.toFixed(0)}%` }
  return { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300', label: `${percent.toFixed(0)}%` }
}

export default function KpiCard({
  label,
  value,
  format,
  delta,
  deltaLabel,
  invertDelta = false,
  target,
  targetPercent,
  subtitle,
}: KpiCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatValue(value, format)}</div>

      {delta != null && delta !== 0 && (
        <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${getDeltaColor(delta, invertDelta)}`}>
          {(invertDelta ? delta < 0 : delta > 0) ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span>
            {format === 'currency' ? `$${Math.abs(delta).toFixed(0)}` : format === 'percent' ? `${(Math.abs(delta) * 100).toFixed(0)}%` : Math.abs(delta).toFixed(1)}
            {deltaLabel ? ` ${deltaLabel}` : ''}
          </span>
        </div>
      )}

      {delta != null && delta === 0 && (
        <div className="flex items-center gap-1 mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          <Minus className="h-3 w-3" />
          <span>No change{deltaLabel ? ` ${deltaLabel}` : ''}</span>
        </div>
      )}

      {target != null && targetPercent != null && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Target: {formatValue(target, format)}</span>
          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${getTargetBadge(targetPercent).bg} ${getTargetBadge(targetPercent).text}`}>
            {getTargetBadge(targetPercent).label}
          </span>
        </div>
      )}

      {subtitle && !target && (
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</div>
      )}
    </div>
  )
}
