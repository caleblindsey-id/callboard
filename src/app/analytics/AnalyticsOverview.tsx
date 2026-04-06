'use client'

import { useState, useCallback } from 'react'
import type { TeamAnalytics } from '@/lib/db/analytics'
import KpiCard from '@/components/analytics/KpiCard'
import Leaderboard from '@/components/analytics/Leaderboard'
import TrendChart from '@/components/analytics/TrendChart'
import TargetsForm from '@/components/analytics/TargetsForm'
import { Target } from 'lucide-react'

interface AnalyticsOverviewProps {
  initialData: TeamAnalytics
}

type PeriodType = 'weekly' | 'monthly'
type SortMetric = 'revenue' | 'tickets' | 'profit' | 'efficiency'
type TrendMetric = 'revenue' | 'tickets' | 'profit'

export default function AnalyticsOverview({ initialData }: AnalyticsOverviewProps) {
  const [data, setData] = useState<TeamAnalytics>(initialData)
  const [periodType, setPeriodType] = useState<PeriodType>(initialData.period.type)
  const [loading, setLoading] = useState(false)
  const [sortMetric, setSortMetric] = useState<SortMetric>('revenue')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [showTargets, setShowTargets] = useState(false)

  const fetchData = useCallback(async (period: PeriodType) => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/analytics/team?period=${period}&date=${today}`)
      if (res.ok) {
        const newData = await res.json()
        setData(newData)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  function handlePeriodChange(period: PeriodType) {
    setPeriodType(period)
    fetchData(period)
  }

  const { teamKpis: kpi, priorKpis: prior } = data

  // Build trend data from all tech rows aggregated by month
  // For team overview, we aggregate the individual tech trend data
  // Since we don't have trend data at team level, we'll use a simple approach
  const trendData = (() => {
    // Generate last 12 months of labels
    const months: { month: number; year: number; label: string }[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        label: d.toLocaleString('en-US', { month: 'short' }),
      })
    }
    // We only have current period data for team overview, so show current month
    return months.map((m) => {
      const isCurrentMonth = m.month === now.getMonth() + 1 && m.year === now.getFullYear()
      return {
        ...m,
        ticketsCompleted: isCurrentMonth ? kpi.ticketsCompleted : 0,
        revenue: isCurrentMonth ? kpi.totalRevenue : 0,
        totalHours: 0,
        grossProfit: isCurrentMonth ? kpi.grossProfit : 0,
      }
    })
  })()

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Technician Analytics</h1>
          <p className="text-sm text-gray-500">{data.period.label}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTargets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Target className="h-4 w-4" />
            Team Targets
          </button>
          <div className="flex border border-gray-200 rounded-md overflow-hidden">
            <button
              onClick={() => handlePeriodChange('weekly')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                periodType === 'weekly' ? 'bg-slate-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => handlePeriodChange('monthly')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                periodType === 'monthly' ? 'bg-slate-800 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              Monthly
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="text-center text-sm text-gray-500 py-2">Updating...</div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Tickets Completed"
          value={kpi.ticketsCompleted}
          format="number"
          delta={kpi.ticketsCompleted - prior.ticketsCompleted}
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
        />
        <KpiCard
          label="Total Revenue"
          value={kpi.totalRevenue}
          format="currency"
          delta={kpi.totalRevenue - prior.totalRevenue}
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
        />
        <KpiCard
          label="Gross Profit"
          value={kpi.grossProfit}
          format="currency"
          delta={kpi.grossProfit != null && prior.grossProfit != null ? kpi.grossProfit - prior.grossProfit : null}
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
        />
        <KpiCard
          label="Avg Hours/Ticket"
          value={kpi.avgHoursPerTicket}
          format="hours"
          delta={kpi.avgHoursPerTicket != null && prior.avgHoursPerTicket != null ? kpi.avgHoursPerTicket - prior.avgHoursPerTicket : null}
          invertDelta
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
        />
        <KpiCard
          label="Avg Completion"
          value={kpi.avgCompletionDays}
          format="days"
          delta={kpi.avgCompletionDays != null && prior.avgCompletionDays != null ? kpi.avgCompletionDays - prior.avgCompletionDays : null}
          invertDelta
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
        />
      </div>

      {/* Leaderboard */}
      <Leaderboard
        techRows={data.techRows}
        activeSort={sortMetric}
        onSortChange={setSortMetric}
      />

      {/* Team Trend Chart */}
      <TrendChart
        data={trendData}
        activeMetric={trendMetric}
        onMetricChange={setTrendMetric}
      />

      {/* Targets Modal */}
      {showTargets && (
        <TargetsForm
          techId={null}
          techName="Team"
          currentTargets={[]}
          periodType={periodType}
          onClose={() => {
            setShowTargets(false)
            fetchData(periodType)
          }}
        />
      )}
    </>
  )
}
