import Link from 'next/link'
import { AlertOctagon, AlertTriangle, ChevronRight, Flag, CreditCard, Clock, Award } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import {
  getOverdueTicketCount,
  getSkipRequestedCount,
  getNeedsReviewCount,
} from '@/lib/db/tickets'
import {
  getCreditHoldCount,
  getStaleEstimatesCount,
  getPendingPayoutApprovalsCount,
} from '@/lib/db/dashboard-metrics'

export default async function AlertsSection() {
  const [
    overdueCount,
    skipRequestedCount,
    needsReviewCount,
    creditHoldCount,
    staleEstimatesCount,
    pendingPayoutApprovalsCount,
  ] = await Promise.all([
    getOverdueTicketCount(),
    getSkipRequestedCount(),
    getNeedsReviewCount(),
    getCreditHoldCount(),
    getStaleEstimatesCount(14),
    getPendingPayoutApprovalsCount(),
  ])

  const hasAlerts =
    overdueCount > 0 ||
    needsReviewCount > 0 ||
    skipRequestedCount > 0 ||
    creditHoldCount > 0 ||
    staleEstimatesCount > 0 ||
    pendingPayoutApprovalsCount > 0

  if (!hasAlerts) return null

  return (
    <section>
      <ZoneHeader label="Needs Attention" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {overdueCount > 0 && (
          <Link
            href="/tickets?overdue=1"
            className="block bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 p-4 hover:border-red-300 dark:hover:border-red-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <AlertOctagon className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <span className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Overdue PMs
                  </span>
                </div>
                <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-1">
                  Tickets from prior months that are still open.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-red-700 dark:text-red-300 tabular-nums">
                  {overdueCount}
                </span>
                <ChevronRight className="h-5 w-5 text-red-400 dark:text-red-500" />
              </div>
            </div>
          </Link>
        )}

        {creditHoldCount > 0 && (
          <Link
            href="/customers?creditHold=1"
            className="block bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 p-4 hover:border-red-300 dark:hover:border-red-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <span className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Credit Hold
                  </span>
                </div>
                <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-1">
                  Customers flagged — verify before billing or scheduling new work.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-red-700 dark:text-red-300 tabular-nums">
                  {creditHoldCount}
                </span>
                <ChevronRight className="h-5 w-5 text-red-400 dark:text-red-500" />
              </div>
            </div>
          </Link>
        )}

        {needsReviewCount > 0 && (
          <Link
            href="/tickets?needsReview=1"
            className="block bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800 p-4 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Flag className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                    Flagged for Review
                  </span>
                </div>
                <p className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-1">
                  Newly-generated PMs whose equipment still has an open prior-month PM.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                  {needsReviewCount}
                </span>
                <ChevronRight className="h-5 w-5 text-blue-400 dark:text-blue-500" />
              </div>
            </div>
          </Link>
        )}

        {skipRequestedCount > 0 && (
          <Link
            href="/tickets?skipRequested=1"
            className="block bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Skip Requests Pending
                  </span>
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  Skip requests awaiting your review.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {skipRequestedCount}
                </span>
                <ChevronRight className="h-5 w-5 text-amber-400 dark:text-amber-500" />
              </div>
            </div>
          </Link>
        )}

        {pendingPayoutApprovalsCount > 0 && (
          <Link
            href="/tech-payouts"
            className="block bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Tech Payouts
                  </span>
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  Tech leads and ACE labor awaiting your approval.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {pendingPayoutApprovalsCount}
                </span>
                <ChevronRight className="h-5 w-5 text-amber-400 dark:text-amber-500" />
              </div>
            </div>
          </Link>
        )}

        {staleEstimatesCount > 0 && (
          <Link
            href="/service?status=estimated"
            className="block bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Stale Estimates
                  </span>
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  Pending customer signature for more than 14 days.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {staleEstimatesCount}
                </span>
                <ChevronRight className="h-5 w-5 text-amber-400 dark:text-amber-500" />
              </div>
            </div>
          </Link>
        )}
      </div>
    </section>
  )
}
