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

function getTargetPercent(row: TechRow, metric: string): number | null {
  const target = row.targets.find((t) => t.metric === metric)
  if (!target) return null

  let actual: number
  switch (metric) {
    case 'tickets_completed': actual = row.ticketsCompleted; break
    case 'revenue': actual = row.revenue; break
    case 'avg_completion_days': actual = row.avgCompletionDays ?? 0; break
    case 'revenue_per_hour': actual = row.revenuePerHour ?? 0; break
    default: return null
  }

  if (target.targetValue === 0) return null
  // For completion days, lower is better — invert the percentage
  if (metric === 'avg_completion_days') {
    return actual === 0 ? 100 : (target.targetValue / actual) * 100
  }
  return (actual / target.targetValue) * 100
}

function getPrimaryTargetPercent(row: TechRow, sort: SortMetric): number | null {
  const metricMap: Record<SortMetric, string> = {
    revenue: 'revenue',
    tickets: 'tickets_completed',
    profit: 'revenue',
    efficiency: 'revenue_per_hour',
  }
  return getTargetPercent(row, metricMap[sort])
}

const sortTabs: { key: SortMetric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'profit', label: 'Profit' },
  { key: 'efficiency', label: 'Efficiency' },
]

export default function Leaderboard({ techRows, activeSort, onSortChange }: LeaderboardProps) {
  const router = useRouter()
  const sorted = [...techRows].sort((a, b) => getSortValue(b, activeSort) - getSortValue(a, activeSort))

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Leaderboard</h2>
        <div className="flex border border-gray-200 rounded-md overflow-hidden">
          {sortTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onSortChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeSort === tab.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-14">Rank</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Technician</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Tickets</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">$/Hour</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
              <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">vs Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((row, i) => {
              const rank = i + 1
              const targetPct = getPrimaryTargetPercent(row, activeSort)
              const belowTarget = targetPct != null && targetPct < 70

              return (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/analytics/${row.id}`)}
                  className={`cursor-pointer transition-colors hover:bg-gray-50 ${belowTarget ? 'bg-red-50/50 hover:bg-red-50' : ''}`}
                >
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        rank === 1
                          ? 'bg-amber-400 text-amber-900'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {rank}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">{row.name}</td>
                  <td className="px-3 py-3 text-right text-gray-900">{row.ticketsCompleted}</td>
                  <td className="px-3 py-3 text-right font-medium text-gray-900">
                    ${row.revenue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-500">{row.totalHours.toFixed(1)}</td>
                  <td className="px-3 py-3 text-right text-gray-900">
                    {row.revenuePerHour != null ? `$${row.revenuePerHour.toFixed(0)}` : '—'}
                  </td>
                  <td className={`px-3 py-3 text-right font-medium ${row.grossProfit != null ? (row.grossProfit >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                    {row.grossProfit != null ? `$${row.grossProfit.toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {targetPct != null ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                          targetPct >= 100
                            ? 'bg-green-100 text-green-700'
                            : targetPct >= 70
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {targetPct.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-500">
                  No technician data available for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-2.5 border-t border-gray-100 text-center text-xs text-gray-400">
        Click any row to view detailed technician profile
      </div>
    </div>
  )
}
