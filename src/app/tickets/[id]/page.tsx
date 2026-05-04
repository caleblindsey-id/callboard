import { getTicket } from '@/lib/db/tickets'
import { getEquipmentServiceHistory } from '@/lib/db/equipment'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import TicketActions from './TicketActions'
import PmPartsSection from './PmPartsSection'
import PoNumberSection from './PoNumberSection'
import DeletedBanner from './DeletedBanner'
import ReviewBanner from './ReviewBanner'
import ChangeLocationSection from './ChangeLocationSection'
import ServiceHistory from '@/components/ServiceHistory'
import EquipmentNotes from '@/components/EquipmentNotes'
import { getCurrentUser, isTechnician, RESET_ROLES } from '@/lib/auth'
import { pmTicketToHistoryItem } from '@/types/service-tickets'
import { getLaborRate } from '@/lib/db/settings'
import { describeSchedule, formatMonthYear } from '@/lib/utils/schedule'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // Include deleted tickets so managers can render the restore banner.
  // Techs are filtered out via the isTechnician check below.
  //
  // Service history depends on the ticket (needs equipment_id), so it can't
  // sit in the top-level Promise.all alongside user. We kick off
  // a chained fetch that starts as soon as the ticket lands — total wait is
  // max(ticket+history, user) instead of sequential.
  const ticketAndHistoryPromise = getTicket(id, { includeDeleted: true }).then(
    async (t) => {
      if (!t || !t.equipment_id) return { ticket: t, serviceHistory: [] as Awaited<ReturnType<typeof getEquipmentServiceHistory>> }
      const sh = await getEquipmentServiceHistory(t.equipment_id, t.id)
      return { ticket: t, serviceHistory: sh }
    }
  )

  const [{ ticket, serviceHistory }, user] = await Promise.all([
    ticketAndHistoryPromise,
    getCurrentUser(),
  ])

  if (!ticket) notFound()

  // Techs can only view their own assigned tickets
  if (isTechnician(user?.role ?? null) && ticket.assigned_technician_id !== user?.id) {
    notFound()
  }

  // Techs never see deleted tickets — only managers can review/restore them.
  if (ticket.deleted_at && isTechnician(user?.role ?? null)) {
    notFound()
  }

  const isDeleted = !!ticket.deleted_at
  const canRestore = !isTechnician(user?.role ?? null) && RESET_ROLES.includes(user?.role ?? ('' as never))

  const laborRate = await getLaborRate(ticket.labor_rate_type ?? 'standard')

  const showBilling = !isTechnician(user?.role ?? null)

  const equipmentLabel = [ticket.equipment?.make, ticket.equipment?.model]
    .filter(Boolean)
    .join(' ') || '—'

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/tickets"
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 transition-colors p-3 -m-3 rounded-md"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white">
              Ticket Detail
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              WO-{ticket.work_order_number} — {ticket.customers?.name ?? 'Unknown Customer'} — {equipmentLabel}
            </p>
          </div>
        </div>
        <div className="pl-8 sm:pl-0 sm:ml-auto">
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      {isDeleted && (
        <DeletedBanner
          ticketId={ticket.id}
          deletedAt={ticket.deleted_at!}
          deletedByName={ticket.deleted_by?.name ?? null}
          canRestore={canRestore}
        />
      )}

      {!isDeleted && ticket.requires_review && !isTechnician(user?.role ?? null) && (
        <ReviewBanner ticketId={ticket.id} reviewReason={ticket.review_reason} />
      )}

      {ticket.customers?.credit_hold && (
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <CreditHoldBadge />
          <span className="text-sm text-red-800 dark:text-red-300 font-semibold">
            This customer is on credit hold. Verify with office before dispatching or billing.
          </span>
        </div>
      )}

      {/* Read-only info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
          Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Customer</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.customers?.name ?? '—'}
              {!isTechnician(user?.role ?? null) && ticket.customer_id && (
                <Link
                  href={`/customers/${ticket.customer_id}`}
                  className="inline-flex items-center ml-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  title="View customer profile"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Account Number</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.customers?.account_number ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Equipment</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {equipmentLabel}
              {ticket.equipment_id && (
                <Link
                  href={`/equipment/${ticket.equipment_id}`}
                  className="inline-flex items-center ml-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  title="View equipment details"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Serial Number</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.equipment?.serial_number ?? '—'}
            </p>
          </div>
          <div className="md:col-span-2">
            <span className="text-gray-500 dark:text-gray-400">Ship-To</span>
            {(() => {
              // Prefer the PM's snapshot ship-to (set when a tech relocates the
              // equipment mid-PM). Fall back to the equipment's home ship-to,
              // then to the customer's billing address.
              const shipTo = ticket.pm_ship_to ?? ticket.equipment?.ship_to_locations
              const shipToAddress = shipTo
                ? [shipTo.address, shipTo.city, shipTo.state, shipTo.zip].filter(Boolean).join(', ')
                : ''
              if (shipTo && shipToAddress) {
                return (
                  <p className="text-gray-900 dark:text-white font-medium">
                    {shipTo.name && <span className="block">{shipTo.name}</span>}
                    <span className="block">{shipToAddress}</span>
                  </p>
                )
              }
              const cust = ticket.customers
              const billingAddress = cust
                ? [cust.billing_address, cust.billing_city, cust.billing_state, cust.billing_zip].filter(Boolean).join(', ')
                : ''
              if (billingAddress) {
                return (
                  <p className="text-gray-900 dark:text-white font-medium">
                    <span className="block">{billingAddress}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">(billing address)</span>
                  </p>
                )
              }
              return <p className="text-gray-900 dark:text-white font-medium">—</p>
            })()}
            {!isDeleted &&
              !['completed', 'billed', 'skipped'].includes(ticket.status) &&
              ticket.customer_id != null &&
              ticket.equipment_id != null && (
                <div className="mt-2">
                  <ChangeLocationSection
                    ticketId={ticket.id}
                    customerId={ticket.customer_id}
                    equipmentId={ticket.equipment_id}
                    currentShipToId={
                      ticket.ship_to_location_id ??
                      ticket.equipment?.ship_to_location_id ??
                      null
                    }
                  />
                </div>
              )}
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Scheduled Date</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.scheduled_date
                ? new Date(ticket.scheduled_date).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Created</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {new Date(ticket.created_at).toLocaleDateString()}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Month / Year</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.month}/{ticket.year}
            </p>
          </div>
          {ticket.pm_schedule_id && ticket.schedule && (
            <>
              <div>
                <span className="text-gray-500 dark:text-gray-400">PM Schedule</span>
                <p className="text-gray-900 dark:text-white font-medium">
                  {describeSchedule(ticket.schedule.interval_months, ticket.schedule.anchor_month)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Last Service</span>
                <p className="text-gray-900 dark:text-white font-medium">
                  {formatMonthYear(ticket.lastServiceMonth, ticket.lastServiceYear)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Next Service</span>
                <p className="text-gray-900 dark:text-white font-medium">
                  {formatMonthYear(ticket.nextServiceMonth, ticket.nextServiceYear)}
                </p>
              </div>
            </>
          )}
          <div>
            <span className="text-gray-500 dark:text-gray-400">Assigned Technician</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.assigned_technician?.name ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">AR Terms</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.customers?.ar_terms ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">PO Required</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.customers?.po_required ? (
                <span className="text-red-700 dark:text-red-400 font-bold">YES — PO REQUIRED</span>
              ) : (
                'No'
              )}
            </p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">PO Number</span>
            <p className="text-gray-900 dark:text-white font-medium">
              {ticket.po_number || '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Parts tracking + Actions are hidden when the ticket is deleted (read-only) */}
      {!isDeleted && (
        <>
          <PoNumberSection
            ticketId={ticket.id}
            initialPoNumber={ticket.po_number ?? null}
          />

          <PmPartsSection
            ticketId={ticket.id}
            initialPartsRequested={ticket.parts_requested ?? []}
            initialSynergyOrderNumber={ticket.synergy_order_number ?? null}
            isTech={isTechnician(user?.role ?? null)}
            canReset={RESET_ROLES.includes(user?.role ?? ('' as never))}
            status={ticket.status}
          />

          <TicketActions
            ticket={ticket}
            userRole={user?.role ?? null}
            userId={user?.id ?? null}
            laborRate={laborRate}
          />
        </>
      )}

      {/* Service History */}
      {ticket.equipment_id && (
        <ServiceHistory
          items={serviceHistory.map(pmTicketToHistoryItem)}
          showBilling={showBilling}
          collapsible
        />
      )}

      {/* Equipment Notes */}
      {ticket.equipment_id && (
        <EquipmentNotes equipmentId={ticket.equipment_id} />
      )}
    </div>
  )
}
