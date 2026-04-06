'use client'

import type { RevenueBreakdownData } from '@/lib/db/analytics'

interface RevenueBreakdownProps {
  data: RevenueBreakdownData
}

export default function RevenueBreakdown({ data }: RevenueBreakdownProps) {
  const total = data.flatRate + data.additionalLabor + data.additionalParts
  const pctFlat = total > 0 ? (data.flatRate / total) * 100 : 0
  const pctLabor = total > 0 ? (data.additionalLabor / total) * 100 : 0
  const pctParts = total > 0 ? (data.additionalParts / total) * 100 : 0

  const items = [
    { label: 'PM Flat Rate', value: data.flatRate, pct: pctFlat, color: 'bg-blue-600' },
    { label: 'Additional Labor', value: data.additionalLabor, pct: pctLabor, color: 'bg-amber-500' },
    { label: 'Additional Parts', value: data.additionalParts, pct: pctParts, color: 'bg-purple-500' },
  ]

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Revenue Breakdown</h3>
      </div>
      <div className="px-5 py-4">
        {total === 0 ? (
          <div className="text-center text-sm text-gray-500 py-4">No revenue data for this period.</div>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="flex h-8 rounded-md overflow-hidden mb-4">
              {items.map(
                (item) =>
                  item.pct > 0 && (
                    <div
                      key={item.label}
                      className={`${item.color} transition-all`}
                      style={{ width: `${item.pct}%` }}
                      title={`${item.label}: ${item.pct.toFixed(0)}%`}
                    />
                  )
              )}
            </div>

            {/* Legend */}
            <div className="space-y-2.5">
              {items.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-sm ${item.color}`} />
                    <span className="text-sm text-gray-700">{item.label}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    ${item.value.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
            </div>

            {/* Additional work rate */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="text-xs text-gray-500">Additional work rate</div>
              <div className="text-lg font-bold text-gray-900">
                {(data.additionalWorkRate * 100).toFixed(0)}%
                <span className="text-xs text-gray-500 font-normal ml-1">
                  of tickets had add-on work
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
