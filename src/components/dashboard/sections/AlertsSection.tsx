import Link from 'next/link'
import { AlertOctagon, AlertTriangle, ChevronRight, Flag, Clock, Award, ShieldAlert, ShoppingCart } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import {
  getOverdueTicketCount,
  getSkipRequestedCount,
  getNeedsReviewCount,
} from '@/lib/db/tickets'
import {
  getStaleEstimatesCount,
  getPendingPayoutApprovalsCount,
} from '@/lib/db/dashboard-metrics'
import { getCreditReviewCounts } from '@/lib/db/credit-reviews'
import { getPendingSupplyRequestCount } from '@/lib/db/supply-requests'

export default async function AlertsSection() {
  const [
    overdueCount,
    skipRequestedCount,
    needsReviewCount,
    staleEstimatesCount,
    pendingPayoutApprovalsCount,
    creditReviewCounts,
    supplyRequestCount,
  ] = await Promise.all([
    getOverdueTicketCount(),
    getSkipRequestedCount(),
    getNeedsReviewCount(),
    getStaleEstimatesCount(14),
    getPendingPayoutApprovalsCount(),
    getCreditReviewCounts(),
    getPendingSupplyRequestCount(),
  ])

  const creditReviewOpen = creditReviewCounts.pending + creditReviewCounts.blocked

  const hasAlerts =
    overdueCount > 0 ||
    needsReviewCount > 0 ||
    skipRequestedCount > 0 ||
    staleEstimatesCount > 0 ||
    pendingPayoutApprovalsCount > 0 ||
    creditReviewOpen > 0 ||
    supplyRequestCount > 0

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

        {creditReviewOpen > 0 && (
          <Link
            href="/credit-review"
            className={`block rounded-lg border p-4 hover:shadow transition-all ${
              creditReviewCounts.blocked > 0
                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 hover:border-amber-300 dark:hover:border-amber-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldAlert className={`h-5 w-5 ${creditReviewCounts.blocked > 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
                  <span className={`text-sm font-semibold ${creditReviewCounts.blocked > 0 ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
                    Credit Review
                  </span>
                </div>
                <p className={`text-xs mt-1 ${creditReviewCounts.blocked > 0 ? 'text-red-700/80 dark:text-red-400/80' : 'text-amber-700/80 dark:text-amber-400/80'}`}>
                  {creditReviewCounts.pending} pending AR · {creditReviewCounts.blocked} blocked. Orders gated for credit approval.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-semibold tabular-nums ${creditReviewCounts.blocked > 0 ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {creditReviewOpen}
                </span>
                <ChevronRight className={`h-5 w-5 ${creditReviewCounts.blocked > 0 ? 'text-red-400 dark:text-red-500' : 'text-amber-400 dark:text-amber-500'}`} />
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

        {supplyRequestCount > 0 && (
          <Link
            href="/supply-requests"
            className="block bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 p-4 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Supply Requests
                  </span>
                </div>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                  Shop supplies techs are waiting on. Pull and mark them ready.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {supplyRequestCount}
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
