import Link from 'next/link'
import { getTickets, getOverdueTicketCount, getSkipRequestedCount } from '@/lib/db/tickets'
import { getServiceTicketCounts, getPartsToOrderCount, getPartsOnOrderCount, getPartsReadyForPickupCount } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import {
  ClipboardList,
  UserCheck,
  Play,
  CheckCircle,
  Receipt,
  SkipForward,
  ChevronRight,
  DollarSign,
  AlertTriangle,
  AlertOctagon,
  Headset,
  PackageSearch,
  PackageCheck,
  Truck,
} from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import SyncStatusBanner from '@/components/SyncStatusBanner'
import { TicketStatus } from '@/types/database'

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

// Techs don't see unassigned tickets — they can't act on them
const techStatusCards = allStatusCards.filter((c) => c.status !== 'unassigned')

export default async function DashboardPage() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const user = await getCurrentUser()
  const isTech = isTechnician(user?.role ?? null)

  const [tickets, overdueCount, skipRequestedCount, serviceCounts, partsToOrderCount, partsOnOrderCount, partsReadyForPickupCount] = await Promise.all([
    getTickets({
      month,
      year,
      ...(isTech && user ? { technicianId: user.id } : {}),
    }),
    getOverdueTicketCount(isTech && user ? { technicianId: user.id } : {}),
    getSkipRequestedCount(isTech && user ? { technicianId: user.id } : {}),
    getServiceTicketCounts(isTech && user ? user.id : undefined),
    isTech ? Promise.resolve(0) : getPartsToOrderCount(),
    isTech ? Promise.resolve(0) : getPartsOnOrderCount(),
    getPartsReadyForPickupCount(),
  ])

  const statusCards = isTech ? techStatusCards : allStatusCards

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

  const mtdRevenue = isTech
    ? tickets
        .filter((t) => t.status === 'completed' || t.status === 'billed')
        .reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)
    : null

  const upcoming = tickets.filter(
    (t) => isTech
      ? t.status === 'assigned' || t.status === 'in_progress'
      : t.status === 'unassigned' || t.status === 'assigned'
  )

  const monthName = now.toLocaleString('default', { month: 'long' })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {monthName} {year} overview
        </p>
      </div>

      {/* Overdue PMs — always surfaced regardless of month filter */}
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
                {isTech
                  ? 'Tickets assigned to you from prior months that are still open.'
                  : 'Tickets from prior months that are still open. Surfaces across all month filters.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-red-700 dark:text-red-300">
                {overdueCount}
              </span>
              <ChevronRight className="h-5 w-5 text-red-400 dark:text-red-500" />
            </div>
          </div>
        </Link>
      )}

      {/* Skip Requests Pending — cross-month, surfaces regardless of month filter */}
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
                {isTech
                  ? 'Skip requests you submitted that are awaiting manager action.'
                  : 'Skip requests awaiting review. Surfaces across all month filters.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-amber-700 dark:text-amber-300">
                {skipRequestedCount}
              </span>
              <ChevronRight className="h-5 w-5 text-amber-400 dark:text-amber-500" />
            </div>
          </div>
        </Link>
      )}

      {/* PM Ticket Stat Cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          PM Tickets — {monthName}
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4 -mt-3">
        {statusCards.map((card) => {
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
              <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
                {counts[card.status]}
              </p>
            </Link>
          )
        })}

        {/* MTD Revenue — technicians only */}
        {mtdRevenue !== null && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                MTD Revenue
              </span>
              <DollarSign className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
              ${mtdRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
        )}
      </div>

      {/* Service Ticket Cards */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
          Service Tickets
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
          {[
            { key: 'open', label: 'Open', color: 'text-green-500' },
            { key: 'estimated', label: 'Estimated', color: 'text-yellow-500' },
            { key: 'approved', label: 'Approved', color: 'text-purple-500' },
            { key: 'in_progress', label: 'In Progress', color: 'text-blue-500' },
            { key: 'completed', label: 'Completed', color: 'text-emerald-500' },
          ].map((card) => (
            <Link
              key={card.key}
              href={`/service?status=${card.key}`}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{card.label}</span>
                <Headset className={`h-5 w-5 ${card.color}`} />
              </div>
              <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
                {serviceCounts[card.key] ?? 0}
              </p>
            </Link>
          ))}

          {/* Parts to Order — office staff only */}
          {!isTech && (
            <Link
              href="/service?waitingOnParts=true"
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Parts to Order</span>
                <PackageSearch className="h-5 w-5 text-amber-500" />
              </div>
              <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
                {partsToOrderCount}
              </p>
            </Link>
          )}

          {/* Parts on Order — office staff only */}
          {!isTech && (
            <Link
              href="/service"
              className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Parts on Order</span>
                <Truck className="h-5 w-5 text-orange-500" />
              </div>
              <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
                {partsOnOrderCount}
              </p>
            </Link>
          )}

          {/* Ready for Pickup — all roles including techs */}
          <Link
            href="/service"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Ready for Pickup</span>
              <PackageCheck className="h-5 w-5 text-green-500" />
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
              {partsReadyForPickupCount}
            </p>
          </Link>
        </div>
      </div>

      {/* Upcoming PMs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Upcoming PMs
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {isTech
              ? `Your assigned and in-progress tickets for ${monthName}`
              : `Unassigned and assigned tickets for ${monthName}`}
          </p>
        </div>
        {upcoming.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No upcoming PMs for this month.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {upcoming.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="block px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">WO-{ticket.work_order_number}</span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {ticket.customers?.name ?? '—'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {[ticket.equipment?.make, ticket.equipment?.model]
                      .filter(Boolean)
                      .join(' ') || '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Scheduled:{' '}
                    {ticket.scheduled_date
                      ? new Date(ticket.scheduled_date).toLocaleDateString()
                      : '—'}{' '}
                    · Tech: {ticket.users?.name ?? '—'}
                  </p>
                </Link>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                      Customer
                    </th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                      Equipment
                    </th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                      Scheduled Date
                    </th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">
                      Technician
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {upcoming.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-5 py-3">
                        <StatusBadge status={ticket.status} />
                      </td>
                      <td className="px-5 py-3 text-gray-900 dark:text-white">
                        {ticket.customers?.name ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {[ticket.equipment?.make, ticket.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.scheduled_date
                          ? new Date(ticket.scheduled_date).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {ticket.users?.name ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Sync status */}
      <div>
        <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Sync Status</h2>
        <SyncStatusBanner />
      </div>
    </div>
  )
}
