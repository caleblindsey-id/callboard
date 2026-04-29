import Link from 'next/link'
import {
  AlertOctagon,
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  Play,
  CheckCircle,
  PackageCheck,
  Truck,
} from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import ZoneHeader from './ZoneHeader'
import type { TicketWithJoins } from '@/lib/db/tickets'

type Props = {
  monthName: string
  month: number
  year: number
  // Open work tally
  openWorkTotal: number
  // Money
  mtdRevenue: number
  // Alerts
  overdueCount: number
  skipRequestedCount: number
  // My ticket counts (PM only — service for techs is handled inline)
  assignedCount: number
  inProgressCount: number
  completedCount: number
  // Parts
  partsOnOrder: number
  partsReady: number
  // Today's schedule (PM tickets assigned/in_progress)
  upcoming: TicketWithJoins[]
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function TechDashboard(p: Props) {
  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">My Day</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {p.monthName} {p.year}
        </p>
      </div>

      {/* === KPI Strip — 2 numbers === */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/tickets"
          className="block rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 p-4 hover:shadow transition-shadow"
        >
          <div className="text-xs uppercase tracking-wide font-medium text-blue-700 dark:text-blue-300">
            My Open Work
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
            {p.openWorkTotal}
          </div>
        </Link>
        <div className="block rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-4">
          <div className="text-xs uppercase tracking-wide font-medium text-emerald-700 dark:text-emerald-300">
            My MTD Revenue
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tabular-nums">
            {fmtMoney(p.mtdRevenue)}
          </div>
        </div>
      </div>

      {/* === Needs Attention — only if any === */}
      {(p.overdueCount > 0 || p.skipRequestedCount > 0 || p.partsReady > 0) && (
        <section>
          <ZoneHeader label="Needs Attention" />
          <div className="grid grid-cols-2 gap-3">
            {p.overdueCount > 0 && (
              <Link
                href="/tickets?overdue=1"
                className="block rounded-lg border bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="text-xs font-medium text-red-700 dark:text-red-300">
                    My Overdue PMs
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.overdueCount}
                </div>
              </Link>
            )}
            {p.partsReady > 0 && (
              <Link
                href="/tickets"
                className="block rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    My Parts Ready
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.partsReady}
                </div>
              </Link>
            )}
            {p.skipRequestedCount > 0 && (
              <Link
                href="/tickets?skipRequested=1"
                className="block rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    My Skip Requests
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.skipRequestedCount}
                </div>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* === My Work === */}
      <section>
        <ZoneHeader label="My Work" />
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={`/tickets?month=${p.month}&year=${p.year}&status=assigned`}
            className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow transition-shadow"
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Assigned</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.assignedCount}
            </div>
          </Link>
          <Link
            href={`/tickets?month=${p.month}&year=${p.year}&status=in_progress`}
            className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow transition-shadow"
          >
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-orange-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">In Progress</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.inProgressCount}
            </div>
          </Link>
          <Link
            href={`/tickets?month=${p.month}&year=${p.year}&status=completed`}
            className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow transition-shadow"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Completed</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.completedCount}
            </div>
          </Link>
          <Link
            href="/tickets"
            className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow transition-shadow"
          >
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-orange-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">My Parts on Order</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.partsOnOrder}
            </div>
          </Link>
        </div>
      </section>

      {/* === My Schedule === */}
      <section>
        <ZoneHeader label="My Schedule" />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          {p.upcoming.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No assigned PMs for {p.monthName}.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {p.upcoming.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="block px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        WO-{ticket.work_order_number}
                      </span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {ticket.customers?.name ?? '—'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {[ticket.equipment?.make, ticket.equipment?.model]
                      .filter(Boolean)
                      .join(' ') || '—'}
                    {ticket.scheduled_date && ` · ${new Date(ticket.scheduled_date).toLocaleDateString()}`}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
