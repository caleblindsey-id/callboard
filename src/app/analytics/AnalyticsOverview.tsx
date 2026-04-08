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
  const deltaLabel = periodType === 'weekly' ? 'vs last week' : 'vs last month'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Technician Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{data.period.label}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTargets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Target className="h-3.5 w-3.5" />
            Team Targets
          </button>
          <div className="flex border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
            <button
              onClick={() => handlePeriodChange('weekly')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                periodType === 'weekly' ? 'bg-slate-800 text-white' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => handlePeriodChange('monthly')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                periodType === 'monthly' ? 'bg-slate-800 text-white' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Monthly
            </button>
          </div>
        </div>
      </div>

      {/* Content — fades during loading */}
      <div className={`space-y-6 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <KpiCard
            label="Tickets Completed"
            value={kpi.ticketsCompleted}
            format="number"
            delta={kpi.ticketsCompleted - prior.ticketsCompleted}
            deltaLabel={deltaLabel}
          />
          <KpiCard
            label="Total Revenue"
            value={kpi.totalRevenue}
            format="currency"
            delta={kpi.totalRevenue - prior.totalRevenue}
            deltaLabel={deltaLabel}
          />
          <KpiCard
            label="Gross Profit"
            value={kpi.grossProfit}
            format="currency"
            delta={kpi.grossProfit != null && prior.grossProfit != null ? kpi.grossProfit - prior.grossProfit : null}
            deltaLabel={deltaLabel}
          />
          <KpiCard
            label="Avg Hours/Ticket"
            value={kpi.avgHoursPerTicket}
            format="hours"
            delta={kpi.avgHoursPerTicket != null && prior.avgHoursPerTicket != null ? kpi.avgHoursPerTicket - prior.avgHoursPerTicket : null}
            invertDelta
            deltaLabel={deltaLabel}
          />
          <KpiCard
            label="Avg Completion"
            value={kpi.avgCompletionDays}
            format="days"
            delta={kpi.avgCompletionDays != null && prior.avgCompletionDays != null ? kpi.avgCompletionDays - prior.avgCompletionDays : null}
            invertDelta
            deltaLabel={deltaLabel}
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
          title={periodType === 'weekly' ? 'Weekly Trend' : 'Monthly Trend'}
          data={data.teamTrend ?? []}
          activeMetric={trendMetric}
          onMetricChange={setTrendMetric}
        />
      </div>

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
    </div>
  )
}
