import Link from 'next/link'
import ZoneHeader from './ZoneHeader'
import type {
  TechLeadsPipeline,
  EstimatesPipeline,
  TechLeadBonusRow,
} from '@/lib/db/dashboard-metrics'

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtMoneyShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

type Props = {
  techLeads: TechLeadsPipeline
  bonusLeaderboard: TechLeadBonusRow[]
  estimates: EstimatesPipeline
}

export default function PipelineAndMoney({ techLeads, bonusLeaderboard, estimates }: Props) {
  const maxBonus = Math.max(1, ...bonusLeaderboard.map((r) => r.amount))

  return (
    <section>
      <ZoneHeader label="Pipeline &amp; Money" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">

        {/* Tech Leads */}
        <Link
          href="/tech-leads"
          className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Tech Leads</div>
            <span className="text-xs text-blue-600 dark:text-blue-400">View all →</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-md p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Pending</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{techLeads.pending}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-md p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Approved</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{techLeads.approved}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-md p-2.5">
              <div className="text-xs text-gray-500 dark:text-gray-400">Match Pending</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{techLeads.matchPending}</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            {fmtMoney(techLeads.activeValue)} in active lead bonus value
          </div>
        </Link>

        {/* Tech Lead Bonus MTD */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Tech Lead Bonus — MTD
            </div>
            <Link href="/tech-leads" className="text-xs text-blue-600 dark:text-blue-400">
              Details →
            </Link>
          </div>
          {bonusLeaderboard.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">No bonuses earned this month yet.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {bonusLeaderboard.map((r) => (
                <div key={r.techId} className="flex items-center justify-between gap-3">
                  <span className="text-gray-700 dark:text-gray-300 truncate">{r.techName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 sm:w-24 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(r.amount / maxBonus) * 100}%` }}
                      />
                    </div>
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">
                      {fmtMoneyShort(r.amount)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Estimates Pipeline */}
        <Link
          href="/service?status=estimated"
          className="md:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Estimates Pipeline</div>
            <span className="text-xs text-blue-600 dark:text-blue-400">View →</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between items-baseline">
              <span className="text-gray-500 dark:text-gray-400">Sent to customer</span>
              <span className="text-gray-900 dark:text-white tabular-nums font-medium">
                {estimates.sent.count} · {fmtMoneyShort(estimates.sent.amount)}
              </span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-emerald-600 dark:text-emerald-400">Approved this month</span>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-medium">
                {estimates.approvedThisMonth.count} · {fmtMoneyShort(estimates.approvedThisMonth.amount)}
              </span>
            </div>
          </div>
        </Link>
      </div>
    </section>
  )
}
