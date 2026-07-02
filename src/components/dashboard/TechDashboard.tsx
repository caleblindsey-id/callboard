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
  FileText,
  Clock,
  ThumbsUp,
  PenLine,
  Wrench,
} from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import ZoneHeader from './ZoneHeader'
import TechDashboardTabs from './TechDashboardTabs'
import type { TicketWithJoins } from '@/lib/db/tickets'
import type { ServiceTicketWithJoins } from '@/types/service-tickets'

type Props = {
  monthName: string
  month: number
  year: number
  // Alerts
  overdueCount: number
  skipRequestedCount: number
  // My PM ticket counts (this month)
  assignedCount: number
  inProgressCount: number
  completedCount: number
  // Parts
  partsOnOrder: number
  partsReady: number
  // PM schedule (assigned/in_progress)
  upcoming: TicketWithJoins[]
  // My service ticket counts (active states)
  serviceOpenCount: number
  serviceEstimatedCount: number
  serviceApprovedCount: number
  serviceInProgressCount: number
  // Service worklist (open/estimated/approved/in_progress)
  serviceWork: ServiceTicketWithJoins[]
  // "Needs my action" service signals
  revisionRequestedCount: number
  equipmentToVerifyCount: number
  // Completed jobs (mine) for PO-required customers still missing a customer PO
  poNeededCount: number
  // Which tab to show first (seeded from server searchParams)
  initialTab: string
}

const cardClass =
  'block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow transition-shadow'

export default function TechDashboard(p: Props) {
  const attentionCount =
    p.overdueCount +
    p.skipRequestedCount +
    p.partsReady +
    p.revisionRequestedCount +
    p.equipmentToVerifyCount +
    p.poNeededCount

  // Combined "Up Next" feed — a few PM + active service items, emergencies first.
  const feedItems = [
    ...p.upcoming.map((t) => ({
      key: `pm-${t.id}`,
      href: `/tickets/${t.id}`,
      wo: t.work_order_number,
      kind: 'pm' as const,
      emergency: false,
      customer: t.customers?.name ?? '—',
      subtitle: [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' '),
      badge: <StatusBadge status={t.status} />,
    })),
    ...p.serviceWork.map((t) => {
      const make = t.equipment?.make ?? t.equipment_make
      const model = t.equipment?.model ?? t.equipment_model
      return {
        key: `svc-${t.id}`,
        href: `/service/${t.id}`,
        wo: t.work_order_number,
        kind: 'service' as const,
        emergency: t.priority === 'emergency',
        customer: t.customers?.name ?? '—',
        subtitle:
          [make, model].filter(Boolean).join(' ') || t.problem_description || '',
        badge: <ServiceStatusBadge status={t.status} />,
      }
    }),
  ]
    .sort((a, b) => Number(b.emergency) - Number(a.emergency))
    .slice(0, 6)

  // === Overview panel: Needs Attention + combined Up Next feed ===
  const overviewPanel = (
    <div className="space-y-6">
      {attentionCount > 0 && (
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
                href="/my-parts"
                className="block rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    My Parts Ready for Pickup
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
            {p.revisionRequestedCount > 0 && (
              <Link
                href="/service"
                className="block rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <PenLine className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Estimate Revision Requested
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.revisionRequestedCount}
                </div>
              </Link>
            )}
            {p.equipmentToVerifyCount > 0 && (
              <Link
                href="/service?status=approved"
                className="block rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Equipment to Verify
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.equipmentToVerifyCount}
                </div>
              </Link>
            )}
            {p.poNeededCount > 0 && (
              <Link
                href="/service?status=completed&poNeeded=1"
                className="block rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-4 hover:shadow transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    My Jobs Waiting on PO
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
                  {p.poNeededCount}
                </div>
              </Link>
            )}
          </div>
        </section>
      )}

      <section>
        <ZoneHeader label="Up Next" />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          {feedItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing active right now. Use the PM and Service tabs for the full picture.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {feedItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="block px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${
                          item.kind === 'pm'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                        }`}
                      >
                        {item.kind === 'pm' ? 'PM' : 'SVC'}
                      </span>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        WO-{item.wo}
                      </span>
                      {item.badge}
                      {item.emergency && (
                        <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 px-2 py-0.5 text-xs font-medium">
                          Emergency
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {item.customer}
                  </p>
                  {item.subtitle && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {item.subtitle}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )

  // === PM panel: My Work counts + My Schedule ===
  const pmPanel = (
    <div className="space-y-6">
      <section>
        <ZoneHeader label="My Work" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link
            href={`/tickets?month=${p.month}&year=${p.year}&status=assigned`}
            className={cardClass}
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
            className={cardClass}
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
            className={cardClass}
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Completed</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.completedCount}
            </div>
          </Link>
          <Link href="/my-parts" className={cardClass}>
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
                  {ticket.equipment?.serial_number && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      SN: {ticket.equipment.serial_number}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )

  // === Service panel: My Service counts + My Service Work ===
  const servicePanel = (
    <div className="space-y-6">
      <section>
        <ZoneHeader label="My Service" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link href="/service?status=open" className={cardClass}>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-green-600" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Open</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.serviceOpenCount}
            </div>
          </Link>
          <Link href="/service?status=estimated" className={cardClass}>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Awaiting Approval</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.serviceEstimatedCount}
            </div>
          </Link>
          <Link href="/service?status=approved" className={cardClass}>
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-4 w-4 text-purple-600" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Approved</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.serviceApprovedCount}
            </div>
          </Link>
          <Link href="/service?status=in_progress" className={cardClass}>
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">In Progress</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white mt-2 tabular-nums">
              {p.serviceInProgressCount}
            </div>
          </Link>
        </div>
      </section>

      <section>
        <ZoneHeader label="My Service Work" />
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          {p.serviceWork.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No open service tickets.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {p.serviceWork.map((t) => {
                const make = t.equipment?.make ?? t.equipment_make
                const model = t.equipment?.model ?? t.equipment_model
                const serial = t.equipment?.serial_number ?? t.equipment_serial_number
                const machine = [make, model].filter(Boolean).join(' ')
                return (
                  <Link
                    key={t.id}
                    href={`/service/${t.id}`}
                    className="block px-4 py-3 active:bg-gray-50 dark:active:bg-gray-700"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          WO-{t.work_order_number}
                        </span>
                        <ServiceStatusBadge status={t.status} />
                        {t.priority === 'emergency' && (
                          <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 px-2 py-0.5 text-xs font-medium">
                            Emergency
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {t.customers?.name ?? '—'}
                    </p>
                    {machine && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {machine}
                        {serial && ` · SN: ${serial}`}
                      </p>
                    )}
                    {t.problem_description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                        {t.problem_description}
                      </p>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )

  // === Tabs: Overview / PM / Service === (header + KPI strip live in page.tsx,
  // streamed separately so this heavier chunk doesn't block them)
  return (
    <TechDashboardTabs
      initialTab={p.initialTab}
      attentionCount={attentionCount}
      pmCount={p.assignedCount + p.inProgressCount}
      serviceCount={p.serviceWork.length}
      overviewContent={overviewPanel}
      pmContent={pmPanel}
      serviceContent={servicePanel}
    />
  )
}
