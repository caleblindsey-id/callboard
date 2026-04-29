import Link from 'next/link'
import { Suspense } from 'react'
import { getTickets, getOverdueTicketCount, getSkipRequestedCount, getNeedsReviewCount } from '@/lib/db/tickets'
import { getServiceTicketCounts, getPartsToOrderCount, getPartsOnOrderCount, getPartsReadyForPickupCount } from '@/lib/db/service-tickets'
import {
  getOpenWorkCounts,
  getMoneyAtRiskCounts,
  getPendingApproval,
  getPartsBlockedCount,
  getMtdRevenue,
  getCreditHoldCount,
  getStaleEstimatesCount,
  getEstimatesPipeline,
  getTechLeadsPipeline,
  getTechLeadBonusLeaderboard,
} from '@/lib/db/dashboard-metrics'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import {
  ClipboardList,
  UserCheck,
  Play,
  CheckCircle,
  Receipt,
  SkipForward,
  ChevronRight,
  AlertTriangle,
  AlertOctagon,
  Flag,
  CreditCard,
  Clock,
  Headset,
} from 'lucide-react'
import SyncStatusBanner from '@/components/SyncStatusBanner'
import { TicketStatus } from '@/types/database'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import KpiStrip, { type KpiCardProps } from '@/components/dashboard/KpiStrip'
import PartsPipeline from '@/components/dashboard/PartsPipeline'
import PipelineAndMoney from '@/components/dashboard/PipelineAndMoney'
import ScheduleSummary from '@/components/dashboard/ScheduleSummary'
import TechDashboard from '@/components/dashboard/TechDashboard'

const allStatusCards: {
  status: TicketStatus
  label: string
  icon: typeof ClipboardList
  color: string
}[] = [
  { status: 'unassigned', label: 'Unassigned', icon: ClipboardList, color: 'text-yellow-500' },
  { status: 'assigned', label: 'Assigned', icon: UserCheck, color: 'text-blue-500' },
  { status: 'in_progress', label: 'In Progress', icon: Play, color: 'text-orange-500' },
  { status: 'completed', label: 'Completed', icon: CheckCircle, color: 'text-green-500' },
  { status: 'billed', label: 'Billed', icon: Receipt, color: 'text-purple-500' },
  { status: 'skipped', label: 'Skipped', icon: SkipForward, color: 'text-gray-400' },
  { status: 'skip_requested', label: 'Skip Requested', icon: AlertTriangle, color: 'text-amber-500' },
]

const serviceStatusCards: { key: string; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: 'text-green-500' },
  { key: 'estimated', label: 'Estimated', color: 'text-yellow-500' },
  { key: 'approved', label: 'Approved', color: 'text-purple-500' },
  { key: 'in_progress', label: 'In Progress', color: 'text-blue-500' },
  { key: 'completed', label: 'Completed', color: 'text-emerald-500' },
]

function fmtMoneyShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default async function DashboardPage() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const monthName = now.toLocaleString('default', { month: 'long' })

  const user = await getCurrentUser()
  const isTech = isTechnician(user?.role ?? null)
  const techScope = isTech && user ? user.id : undefined

  // ---- Tech view: lighter data load, dedicated layout ----
  if (isTech && user) {
    const [
      tickets,
      overdueCount,
      skipRequestedCount,
      partsOnOrder,
      partsReadyForPickup,
      openWork,
    ] = await Promise.all([
      getTickets({ month, year, technicianId: user.id }),
      getOverdueTicketCount({ technicianId: user.id }),
      getSkipRequestedCount({ technicianId: user.id }),
      getPartsOnOrderCount(user.id),
      getPartsReadyForPickupCount(user.id),
      getOpenWorkCounts(user.id),
    ])

    const myCounts = { assigned: 0, in_progress: 0, completed: 0 }
    let mtdRevenue = 0
    for (const t of tickets) {
      if (t.status === 'assigned') myCounts.assigned++
      if (t.status === 'in_progress') myCounts.in_progress++
      if (t.status === 'completed') myCounts.completed++
      if (t.status === 'completed' || t.status === 'billed') {
        mtdRevenue += t.billing_amount ?? 0
      }
    }

    const upcoming = tickets.filter(
      (t) => t.status === 'assigned' || t.status === 'in_progress'
    )

    return (
      <TechDashboard
        monthName={monthName}
        month={month}
        year={year}
        openWorkTotal={openWork.total}
        mtdRevenue={mtdRevenue}
        overdueCount={overdueCount}
        skipRequestedCount={skipRequestedCount}
        assignedCount={myCounts.assigned}
        inProgressCount={myCounts.in_progress}
        completedCount={myCounts.completed}
        partsOnOrder={partsOnOrder}
        partsReady={partsReadyForPickup}
        upcoming={upcoming}
      />
    )
  }

  // ---- Manager view: full data load, all zones ----
  const [
    tickets,
    overdueCount,
    skipRequestedCount,
    needsReviewCount,
    serviceCounts,
    pmPartsToOrder,
    pmPartsOnOrder,
    pmPartsReadyForPickup,
    svcPartsToOrder,
    svcPartsOnOrder,
    svcPartsReadyForPickup,
    openWork,
    moneyAtRisk,
    pendingApproval,
    partsBlocked,
    mtdRevenue,
    creditHoldCount,
    staleEstimatesCount,
    estimatesPipeline,
    techLeadsPipeline,
    bonusLeaderboard,
  ] = await Promise.all([
    getTickets({ month, year }),
    getOverdueTicketCount(),
    getSkipRequestedCount(),
    getNeedsReviewCount(),
    getServiceTicketCounts(techScope),
    getPartsToOrderCount('pm'),
    getPartsOnOrderCount(undefined, 'pm'),
    getPartsReadyForPickupCount(undefined, 'pm'),
    getPartsToOrderCount('service'),
    getPartsOnOrderCount(undefined, 'service'),
    getPartsReadyForPickupCount(undefined, 'service'),
    getOpenWorkCounts(),
    getMoneyAtRiskCounts(),
    getPendingApproval(),
    getPartsBlockedCount(),
    getMtdRevenue(),
    getCreditHoldCount(),
    getStaleEstimatesCount(14),
    getEstimatesPipeline(),
    getTechLeadsPipeline(),
    getTechLeadBonusLeaderboard(5),
  ])

  const counts: Record<TicketStatus, number> = {
    unassigned: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    billed: 0,
    skipped: 0,
    skip_requested: 0,
  }
  for (const t of tickets) {
    counts[t.status]++
  }

  // Schedule summary derivations from current-month tickets
  const todayStr = now.toISOString().slice(0, 10)
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay()) // Sunday
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  let scheduleToday = 0
  let scheduleThisWeek = 0
  let scheduleUnscheduled = 0
  for (const t of tickets) {
    if (t.status === 'completed' || t.status === 'billed' || t.status === 'skipped') continue
    if (!t.scheduled_date) {
      scheduleUnscheduled++
      continue
    }
    if (t.scheduled_date === todayStr) scheduleToday++
    const d = new Date(t.scheduled_date)
    if (d >= startOfWeek && d < endOfWeek) scheduleThisWeek++
  }

  const kpiCards: KpiCardProps[] = [
    {
      label: 'Open Work',
      value: openWork.total.toLocaleString('en-US'),
      subtitle: `PM ${openWork.pm} · Svc ${openWork.service}`,
      tone: 'blue',
      href: '/tickets',
    },
    {
      label: 'Money at Risk',
      value: moneyAtRisk.total.toLocaleString('en-US'),
      subtitle: `${moneyAtRisk.creditHold} on hold · ${moneyAtRisk.overdue} overdue`,
      tone: 'red',
      href: '/tickets?overdue=1',
    },
    {
      label: 'Pending Approval',
      value: fmtMoneyShort(pendingApproval.amount),
      subtitle: `${pendingApproval.count} estimates awaiting signature`,
      tone: 'amber',
      href: '/service?status=estimated',
    },
    {
      label: 'Parts Blocked',
      value: partsBlocked.toLocaleString('en-US'),
      subtitle: 'Tickets waiting on parts',
      tone: 'purple',
      href: '/parts-queue',
    },
    {
      label: 'MTD Revenue',
      value: fmtMoneyShort(mtdRevenue.total),
      subtitle: `PM ${fmtMoneyShort(mtdRevenue.pm)} · Svc ${fmtMoneyShort(mtdRevenue.service)}`,
      tone: 'emerald',
    },
  ]

  const hasAlerts =
    overdueCount > 0 ||
    needsReviewCount > 0 ||
    skipRequestedCount > 0 ||
    creditHoldCount > 0 ||
    staleEstimatesCount > 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {monthName} {year} overview
        </p>
      </div>

      {/* === KPI Strip === */}
      <KpiStrip cards={kpiCards} />

      {/* === Needs Attention === */}
      {hasAlerts && (
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
      )}

      {/* === PM Tickets — status only === */}
      <section>
        <ZoneHeader label={`PM Tickets — ${monthName}`} />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
          {allStatusCards.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.status}
                href={`/tickets?month=${month}&year=${year}&status=${card.status}`}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {card.label}
                  </span>
                  <Icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
                  {counts[card.status]}
                </p>
              </Link>
            )
          })}
        </div>
      </section>

      {/* === Service Tickets — status only === */}
      <section>
        <ZoneHeader label="Service Tickets" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
          {serviceStatusCards.map((card) => (
            <Link
              key={card.key}
              href={`/service?status=${card.key}`}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{card.label}</span>
                <Headset className={`h-5 w-5 ${card.color}`} />
              </div>
              <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
                {serviceCounts[card.key] ?? 0}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* === Parts Pipeline === */}
      <PartsPipeline
        isTech={false}
        pmPartsToOrder={pmPartsToOrder}
        pmPartsOnOrder={pmPartsOnOrder}
        pmPartsReady={pmPartsReadyForPickup}
        svcPartsToOrder={svcPartsToOrder}
        svcPartsOnOrder={svcPartsOnOrder}
        svcPartsReady={svcPartsReadyForPickup}
      />

      {/* === Pipeline & Money === */}
      <PipelineAndMoney
        techLeads={techLeadsPipeline}
        bonusLeaderboard={bonusLeaderboard}
        estimates={estimatesPipeline}
      />

      {/* === Schedule (collapsed summary) === */}
      <ScheduleSummary
        today={scheduleToday}
        thisWeek={scheduleThisWeek}
        unscheduled={scheduleUnscheduled}
        monthName={monthName}
        month={month}
        year={year}
      />

      {/* === Sync Status — manager+ only === */}
      <section>
        <ZoneHeader label="Sync Status" />
        <Suspense fallback={
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="h-5 w-40 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
          </div>
        }>
          <SyncStatusBanner />
        </Suspense>
      </section>
    </div>
  )
}
