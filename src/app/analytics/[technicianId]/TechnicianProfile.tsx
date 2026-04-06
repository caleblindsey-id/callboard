'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Target } from 'lucide-react'
import type { TechnicianAnalytics } from '@/lib/db/analytics'
import KpiCard from '@/components/analytics/KpiCard'
import TrendChart from '@/components/analytics/TrendChart'
import RevenueBreakdown from '@/components/analytics/RevenueBreakdown'
import PeriodComparison from '@/components/analytics/PeriodComparison'
import TargetsForm from '@/components/analytics/TargetsForm'

interface TechnicianProfileProps {
  initialData: TechnicianAnalytics
}

type PeriodType = 'weekly' | 'monthly'
type TrendMetric = 'revenue' | 'tickets' | 'profit'

function getTargetValue(targets: TechnicianAnalytics['targets'], metric: string): number | null {
  return targets.find((t) => t.metric === metric)?.targetValue ?? null
}

function getTargetPercent(actual: number | null, target: number | null, invert = false): number | null {
  if (actual == null || target == null || target === 0) return null
  if (invert) return actual === 0 ? 100 : (target / actual) * 100
  return (actual / target) * 100
}

export default function TechnicianProfile({ initialData }: TechnicianProfileProps) {
  const [data, setData] = useState<TechnicianAnalytics>(initialData)
  const [periodType, setPeriodType] = useState<PeriodType>(initialData.period.type)
  const [loading, setLoading] = useState(false)
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('revenue')
  const [showTargets, setShowTargets] = useState(false)

  const fetchData = useCallback(async (period: PeriodType) => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/analytics/technician/${data.tech.id}?period=${period}&date=${today}`)
      if (res.ok) {
        const newData = await res.json()
        setData(newData)
      }
    } finally {
      setLoading(false)
    }
  }, [data.tech.id])

  function handlePeriodChange(period: PeriodType) {
    setPeriodType(period)
    fetchData(period)
  }

  const { current, prior, yoy, targets } = data

  return (
    <>
      {/* Header */}
      <div>
        <Link href="/analytics" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Analytics
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{data.tech.name}</h1>
            <p className="text-sm text-gray-500">
              Technician{data.tech.hourlyCost != null ? ` · Hourly cost: $${data.tech.hourlyCost.toFixed(2)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTargets(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Target className="h-4 w-4" />
              Set Targets
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
      </div>

      {loading && (
        <div className="text-center text-sm text-gray-500 py-2">Updating...</div>
      )}

      {/* Scorecard Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Tickets"
          value={current.ticketsCompleted}
          format="number"
          target={getTargetValue(targets, 'tickets_completed')}
          targetPercent={getTargetPercent(current.ticketsCompleted, getTargetValue(targets, 'tickets_completed'))}
        />
        <KpiCard
          label="Revenue"
          value={current.revenue}
          format="currency"
          target={getTargetValue(targets, 'revenue')}
          targetPercent={getTargetPercent(current.revenue, getTargetValue(targets, 'revenue'))}
        />
        <KpiCard
          label="Hours"
          value={current.totalHours}
          format="hours"
          subtitle={current.ticketsCompleted > 0 ? `Avg ${(current.totalHours / current.ticketsCompleted).toFixed(1)}/ticket` : undefined}
        />
        <KpiCard
          label="Revenue/Hr"
          value={current.revenuePerHour}
          format="currency"
          delta={current.revenuePerHour != null && prior.revenuePerHour != null ? current.revenuePerHour - prior.revenuePerHour : null}
          deltaLabel={periodType === 'weekly' ? 'vs last week' : 'vs last month'}
          target={getTargetValue(targets, 'revenue_per_hour')}
          targetPercent={getTargetPercent(current.revenuePerHour, getTargetValue(targets, 'revenue_per_hour'))}
        />
        <KpiCard
          label="Gross Profit"
          value={current.grossProfit}
          format="currency"
          subtitle={current.laborCost != null ? `Cost: $${current.laborCost.toFixed(0)}` : undefined}
        />
        <KpiCard
          label="Avg Completion"
          value={current.avgCompletionDays}
          format="days"
          target={getTargetValue(targets, 'avg_completion_days')}
          targetPercent={getTargetPercent(current.avgCompletionDays, getTargetValue(targets, 'avg_completion_days'), true)}
        />
      </div>

      {/* Two-column: Trend + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <TrendChart
            data={data.trend}
            activeMetric={trendMetric}
            onMetricChange={setTrendMetric}
            targets={targets}
          />
        </div>
        <div className="lg:col-span-2">
          <RevenueBreakdown data={data.revenueBreakdown} />
        </div>
      </div>

      {/* Period Comparison */}
      <PeriodComparison current={current} prior={prior} yoy={yoy} />

      {/* Recent Tickets */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Recent Tickets</h3>
          <Link
            href={`/tickets?technicianId=${data.tech.id}`}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">WO</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Profit</th>
                <th className="px-5 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.recentTickets.map((ticket) => {
                const totalHours = (ticket.hoursWorked ?? 0) + (ticket.additionalHoursWorked ?? 0)
                const profit = ticket.billingAmount != null && ticket.laborCost != null
                  ? ticket.billingAmount - ticket.laborCost
                  : null

                return (
                  <tr key={ticket.id}>
                    <td className="px-5 py-2.5">
                      <Link href={`/tickets/${ticket.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
                        WO-{ticket.workOrderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-gray-900">{ticket.customerName ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">
                      {ticket.completedDate
                        ? new Date(ticket.completedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-900">{totalHours > 0 ? totalHours.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-900">
                      {ticket.billingAmount != null ? `$${ticket.billingAmount.toLocaleString()}` : '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-medium ${profit != null ? (profit >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                      {profit != null ? `$${profit.toFixed(0)}` : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        ticket.status === 'billed'
                          ? 'bg-green-100 text-green-700'
                          : ticket.status === 'completed'
                          ? 'bg-blue-100 text-blue-700'
                          : ticket.status === 'in_progress'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {data.recentTickets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-500">
                    No recent tickets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Targets Modal */}
      {showTargets && (
        <TargetsForm
          techId={data.tech.id}
          techName={data.tech.name}
          currentTargets={targets}
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
