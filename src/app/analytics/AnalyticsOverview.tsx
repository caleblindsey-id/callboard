'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { TeamAnalytics, TicketType } from '@/lib/db/analytics'
import KpiCard from '@/components/analytics/KpiCard'
import Leaderboard from '@/components/analytics/Leaderboard'
import TargetsForm from '@/components/analytics/TargetsForm'
import BacklogPanel from '@/components/analytics/BacklogPanel'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { Target } from 'lucide-react'

// Recharts is ~200KB; defer the chart so the page shell + KPIs render first.
const TrendChart = dynamic(() => import('@/components/analytics/TrendChart'), {
  ssr: false,
  loading: () => (
    <div className="h-64 bg-gray-50 dark:bg-gray-800/50 rounded-lg animate-pulse" />
  ),
})

interface AnalyticsOverviewProps {
  initialData: TeamAnalytics
}

type PeriodType = 'weekly' | 'monthly'
type SortMetric = 'revenue' | 'tickets' | 'profit' | 'efficiency'
type TrendMetric = 'revenue' | 'tickets' | 'profit'

export default function AnalyticsOverview({ initialData }: AnalyticsOverviewProps) {
  const [data, setData] = useState<TeamAnalytics>(initialData)
  const [periodType, setPeriodType] = useState<PeriodType>(initialData.period.type)
  const [ticketType, setTicketType] = useState<TicketType>(initialData.ticketType)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [sortMetric, setSortMetric] = useState<SortMetric>('revenue')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [showTargets, setShowTargets] = useState(false)

  const fetchData = useCallback(async (period: PeriodType, type: TicketType) => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/analytics/team?period=${period}&date=${today}&type=${type}`)
      if (!res.ok) {
        setError(true)
        return
      }
      const newData = await res.json()
      setData(newData)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  function handlePeriodChange(period: PeriodType) {
    setPeriodType(period)
    fetchData(period, ticketType)
  }

  function handleTypeChange(type: TicketType) {
    setTicketType(type)
    fetchData(periodType, type)
  }

  const { teamKpis: kpi, priorKpis: prior } = data
  const deltaLabel = periodType === 'weekly' ? 'vs last week' : 'vs last month'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <PageHeader
        title="Technician Analytics"
        subtitle={data.period.label}
        actions={
          <>
            <button
              onClick={() => setShowTargets(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <Target className="h-3.5 w-3.5" />
              Team Targets
            </button>
            <SegmentedControl
              ariaLabel="Ticket type"
              options={[
                { value: 'combined', label: 'Combined' },
                { value: 'pm', label: 'PM' },
                { value: 'service', label: 'Service' },
              ]}
              value={ticketType}
              onChange={(v) => handleTypeChange(v as TicketType)}
            />
            <SegmentedControl
              ariaLabel="Analytics period"
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              value={periodType}
              onChange={(v) => handlePeriodChange(v as PeriodType)}
            />
          </>
        }
      />

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <p className="flex-1">Failed to load this period. The data below may be stale.</p>
          <button
            type="button"
            onClick={() => fetchData(periodType, ticketType)}
            className="shrink-0 font-medium underline"
          >
            Retry
          </button>
        </div>
      )}

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

        {/* Operational health / backlog — point-in-time, ignores the period toggle */}
        <BacklogPanel backlog={data.backlog} ticketType={ticketType} />
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
            fetchData(periodType, ticketType)
          }}
        />
      )}
    </div>
  )
}
