'use client'

import { useRouter } from 'next/navigation'
import type { TechRow } from '@/lib/db/analytics'

type SortMetric = 'revenue' | 'tickets' | 'profit' | 'efficiency'

interface LeaderboardProps {
  techRows: TechRow[]
  activeSort: SortMetric
  onSortChange: (sort: SortMetric) => void
}

function getSortValue(row: TechRow, sort: SortMetric): number {
  switch (sort) {
    case 'revenue': return row.revenue
    case 'tickets': return row.ticketsCompleted
    case 'profit': return row.grossProfit ?? -Infinity
    case 'efficiency': return row.revenuePerHour ?? -Infinity
  }
}

function getPrimaryTargetPercent(row: TechRow, sort: SortMetric): number | null {
  const metricMap: Record<SortMetric, string> = {
    revenue: 'revenue',
    tickets: 'tickets_completed',
    profit: 'revenue',
    efficiency: 'revenue_per_hour',
  }
  const metric = metricMap[sort]
  const target = row.targets.find((t) => t.metric === metric)
  if (!target || target.targetValue === 0) return null

  let actual: number
  switch (metric) {
    case 'tickets_completed': actual = row.ticketsCompleted; break
    case 'revenue': actual = row.revenue; break
    case 'revenue_per_hour': actual = row.revenuePerHour ?? 0; break
    default: return null
  }
  return (actual / target.targetValue) * 100
}

const sortTabs: { key: SortMetric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'profit', label: 'Profit' },
  { key: 'efficiency', label: 'Efficiency' },
]

function TargetBadge({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
  const style = percent >= 100
    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
    : percent >= 70
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>
      {percent.toFixed(0)}%
    </span>
  )
}

export default function Leaderboard({ techRows, activeSort, onSortChange }: LeaderboardProps) {
  const router = useRouter()
  const sorted = [...techRows].sort((a, b) => getSortValue(b, activeSort) - getSortValue(a, activeSort))

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Leaderboard</h2>
        <div className="flex border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
          {sortTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onSortChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeSort === tab.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-14">Rank</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Technician</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tickets</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Revenue</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Hours</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">$/Hour</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Profit</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">vs Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {sorted.map((row, i) => {
              const rank = i + 1
              const targetPct = getPrimaryTargetPercent(row, activeSort)
              const belowTarget = targetPct != null && targetPct < 70

              return (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/analytics/${row.id}`)}
                  className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${belowTarget ? 'bg-red-50/50 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20' : ''}`}
                >
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      rank === 1 ? 'bg-amber-400 text-amber-900' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      {rank}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">{row.name}</td>
                  <td className="px-3 py-3 text-right text-gray-900 dark:text-white">{row.ticketsCompleted}</td>
                  <td className="px-3 py-3 text-right font-medium text-gray-900 dark:text-white">
                    ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-500 dark:text-gray-400">{row.totalHours.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right text-gray-900 dark:text-white">
                    {row.revenuePerHour != null ? `$${row.revenuePerHour.toFixed(0)}` : '—'}
                  </td>
                  <td className={`px-3 py-3 text-right font-medium ${row.grossProfit != null ? (row.grossProfit >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400 dark:text-gray-500'}`}>
                    {row.grossProfit != null ? `$${row.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <TargetBadge percent={targetPct} />
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No technician data available for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-5 py-2.5 border-t border-gray-100 dark:border-gray-700 text-center text-xs text-gray-400 dark:text-gray-500">
          Click any row to view detailed technician profile
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map((row, i) => {
          const rank = i + 1
          const targetPct = getPrimaryTargetPercent(row, activeSort)
          const belowTarget = targetPct != null && targetPct < 70

          return (
            <div
              key={row.id}
              onClick={() => router.push(`/analytics/${row.id}`)}
              className={`px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700 ${belowTarget ? 'bg-red-50/30 dark:bg-red-900/10' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    rank === 1 ? 'bg-amber-400 text-amber-900' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}>
                    {rank}
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{row.name}</span>
                </div>
                <TargetBadge percent={targetPct} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Tickets</span>
                  <span className="font-medium text-gray-900 dark:text-white">{row.ticketsCompleted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Revenue</span>
                  <span className="font-medium text-gray-900 dark:text-white">${row.revenue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">$/Hour</span>
                  <span className="text-gray-900 dark:text-white">{row.revenuePerHour != null ? `$${row.revenuePerHour.toFixed(0)}` : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Profit</span>
                  <span className={`font-medium ${row.grossProfit != null ? (row.grossProfit >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400 dark:text-gray-500'}`}>
                    {row.grossProfit != null ? `$${row.grossProfit.toLocaleString()}` : '—'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No technician data available for this period.
          </div>
        )}
      </div>
    </div>
  )
}
