'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { TrendPoint, ResolvedTarget } from '@/lib/db/analytics'

type Metric = 'revenue' | 'tickets' | 'profit'

interface TrendChartProps {
  data: TrendPoint[]
  activeMetric: Metric
  onMetricChange: (metric: Metric) => void
  targets?: ResolvedTarget[]
}

const metricTabs: { key: Metric; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'tickets', label: 'Tickets' },
  { key: 'profit', label: 'Profit' },
]

function getDataKey(metric: Metric): keyof TrendPoint {
  switch (metric) {
    case 'revenue': return 'revenue'
    case 'tickets': return 'ticketsCompleted'
    case 'profit': return 'grossProfit'
  }
}

function getTargetValue(targets: ResolvedTarget[] | undefined, metric: Metric): number | null {
  if (!targets) return null
  const metricMap: Record<Metric, string> = {
    revenue: 'revenue',
    tickets: 'tickets_completed',
    profit: 'revenue',
  }
  const target = targets.find((t) => t.metric === metricMap[metric])
  return target?.targetValue ?? null
}

function formatTooltipValue(value: number, metric: Metric): string {
  if (metric === 'revenue' || metric === 'profit') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
  return value.toString()
}

export default function TrendChart({ data, activeMetric, onMetricChange, targets }: TrendChartProps) {
  const dataKey = getDataKey(activeMetric)
  const targetValue = getTargetValue(targets, activeMetric)

  const chartData = data.map((d) => ({
    ...d,
    value: d[dataKey] ?? 0,
  }))

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Monthly Trend</h3>
        <div className="flex border border-gray-200 rounded-md overflow-hidden">
          {metricTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onMetricChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeMetric === tab.key
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={50}
              tickFormatter={(v: number) =>
                activeMetric === 'tickets' ? v.toString() : `$${(v / 1000).toFixed(1)}k`
              }
            />
            <Tooltip
              formatter={(value) => [formatTooltipValue(Number(value), activeMetric), metricTabs.find((t) => t.key === activeMetric)?.label]}
              labelStyle={{ color: '#374151', fontWeight: 600, fontSize: 12 }}
              contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
            />
            {targetValue != null && (
              <ReferenceLine
                y={targetValue}
                stroke="#f59e0b"
                strokeDasharray="6 3"
                label={{
                  value: `Target: ${activeMetric === 'tickets' ? targetValue : '$' + targetValue.toLocaleString()}`,
                  position: 'insideTopRight',
                  fill: '#f59e0b',
                  fontSize: 10,
                }}
              />
            )}
            <Bar
              dataKey="value"
              fill="#2563eb"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
