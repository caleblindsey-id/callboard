import Link from 'next/link'
import { getTickets } from '@/lib/db/tickets'
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
]

// Techs don't see unassigned tickets — they can't act on them
const techStatusCards = allStatusCards.filter((c) => c.status !== 'unassigned')

export default async function DashboardPage() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const user = await getCurrentUser()
  const isTech = isTechnician(user?.role ?? null)

  const tickets = await getTickets({
    month,
    year,
    ...(isTech && user ? { technicianId: user.id } : {}),
  })

  const statusCards = isTech ? techStatusCards : allStatusCards

  const counts: Record<TicketStatus, number> = {
    unassigned: 0,
    assigned: 0,
    in_progress: 0,
    completed: 0,
    billed: 0,
    skipped: 0,
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
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
