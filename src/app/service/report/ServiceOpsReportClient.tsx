'use client'

import { useRouter } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import KpiCard from '@/components/analytics/KpiCard'
import Tabs from '@/components/ui/Tabs'
import type { ServiceOpsReport } from '@/lib/db/service-reports'

const RANGES: { key: string; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
  { key: 'all', label: 'All time' },
]

function money(v: number | null): string {
  if (v == null) return '—'
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function SectionCard({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{blurb}</p>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  )
}

function CountTable({ rows, nameHeader }: { rows: { name: string; count: number }[]; nameHeader: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">None in this period.</p>
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          <th className="py-1.5 pr-2 font-medium">{nameHeader}</th>
          <th className="py-1.5 text-right font-medium w-20">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-gray-100 dark:border-gray-700">
            <td className="py-1.5 pr-2 text-gray-900 dark:text-white">{r.name}</td>
            <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-white">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function ServiceOpsReportClient({
  report,
  range,
}: {
  report: ServiceOpsReport
  range: string
}) {
  const router = useRouter()
  const { estimates, warranty, marginOverrides, pmSkips } = report

  const isEmpty =
    estimates.sent === 0 &&
    estimates.declined === 0 &&
    warranty.filed === 0 &&
    marginOverrides.count === 0 &&
    pmSkips.total === 0

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <Tabs
        ariaLabel="Report date range"
        active={range}
        onChange={(key) => router.push(`/service/report?range=${key}`)}
        tabs={RANGES.map((r) => ({ key: r.key, label: r.label }))}
        className="w-fit"
      />

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing to report in this period.</p>
        </div>
      ) : (
        <>
          <SectionCard
            title="Estimates"
            blurb="Sent and approved are counted by their own stamps in the window; declines come from the permanent estimate log, so reopened tickets still count."
          >
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard label="Sent" value={estimates.sent} format="number" />
              <KpiCard label="Approved" value={estimates.approved} format="number" />
              <KpiCard label="Declined" value={estimates.declined} format="number" />
              <KpiCard
                label="Win rate"
                value={estimates.winRatePct != null ? estimates.winRatePct / 100 : null}
                format="percent"
                subtitle="of decided estimates"
              />
              <KpiCard
                label="Awaiting decision"
                value={estimates.awaitingDecision}
                format="number"
                subtitle="right now"
              />
            </div>
            {estimates.declined > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide font-medium">
                    Avg declined estimate
                  </p>
                  <p className="text-lg font-semibold text-gray-900 dark:text-white">
                    {money(estimates.avgDeclinedAmount)}
                  </p>
                </div>
                {estimates.declineReasons.length > 0 && (
                  <CountTable
                    nameHeader="Top decline reasons"
                    rows={estimates.declineReasons.map((r) => ({ name: r.reason, count: r.count }))}
                  />
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Warranty credit recovery"
            blurb="Claims filed with vendors and the credits that came back. Outstanding is everything filed and still waiting, regardless of window."
          >
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard label="Claims filed" value={warranty.filed} format="number" />
              <KpiCard label="Credits received" value={warranty.received} format="number" />
              <KpiCard label="Recovered" value={warranty.receivedAmount} format="currency" />
              <KpiCard
                label="Outstanding expected"
                value={warranty.outstandingExpected}
                format="currency"
                subtitle="filed, not credited"
              />
              <KpiCard
                label="Median days to credit"
                value={warranty.medianDaysToCredit}
                format="days"
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Margin overrides"
            blurb="Below-floor estimate lines a manager approved with a justification."
          >
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard label="Overrides" value={marginOverrides.count} format="number" />
            </div>
            <CountTable nameHeader="By manager" rows={marginOverrides.byUser} />
          </SectionCard>

          <SectionCard
            title="PM skips"
            blurb="Skipped PM tickets bucketed by their scheduled month. A high stop share means machines are leaving the fleet, not just rescheduling."
          >
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <KpiCard label="Skipped PMs" value={pmSkips.total} format="number" />
              <KpiCard
                label="Stop share"
                value={pmSkips.stopSharePct != null ? pmSkips.stopSharePct / 100 : null}
                format="percent"
                subtitle="removed / service ended"
              />
            </div>
            <CountTable
              nameHeader="By reason"
              rows={pmSkips.byCategory.map((c) => ({ name: c.label, count: c.count }))}
            />
          </SectionCard>
        </>
      )}
    </div>
  )
}
