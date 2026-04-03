import { getTicket } from '@/lib/db/tickets'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import StatusBadge from '@/components/StatusBadge'
import TicketActions from './TicketActions'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getSetting } from '@/lib/db/settings'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [ticket, user, laborRateStr] = await Promise.all([
    getTicket(id),
    getCurrentUser(),
    getSetting('labor_rate_per_hour'),
  ])

  if (!ticket) notFound()

  // Techs can only view their own assigned tickets
  if (isTechnician(user?.role ?? null) && ticket.assigned_technician_id !== user?.id) {
    notFound()
  }

  const laborRate = laborRateStr ? parseFloat(laborRateStr) : 75

  const equipmentLabel = [ticket.equipment?.make, ticket.equipment?.model]
    .filter(Boolean)
    .join(' ') || '—'

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/tickets"
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 -m-2 rounded-md"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">
              Ticket Detail
            </h1>
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              WO-{ticket.work_order_number} — {ticket.customers?.name ?? 'Unknown Customer'} — {equipmentLabel}
            </p>
          </div>
        </div>
        <div className="pl-8 sm:pl-0 sm:ml-auto">
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      {/* Read-only info */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
          Details
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div>
            <span className="text-gray-500">Customer</span>
            <p className="text-gray-900 font-medium">
              {ticket.customers?.name ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Account Number</span>
            <p className="text-gray-900 font-medium">
              {ticket.customers?.account_number ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Equipment</span>
            <p className="text-gray-900 font-medium">{equipmentLabel}</p>
          </div>
          <div>
            <span className="text-gray-500">Serial Number</span>
            <p className="text-gray-900 font-medium">
              {ticket.equipment?.serial_number ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">City</span>
            <p className="text-gray-900 font-medium">
              {ticket.equipment?.ship_to_locations?.city ?? ticket.customers?.billing_city ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Scheduled Date</span>
            <p className="text-gray-900 font-medium">
              {ticket.scheduled_date
                ? new Date(ticket.scheduled_date).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Created</span>
            <p className="text-gray-900 font-medium">
              {new Date(ticket.created_at).toLocaleDateString()}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Month / Year</span>
            <p className="text-gray-900 font-medium">
              {ticket.month}/{ticket.year}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Assigned Technician</span>
            <p className="text-gray-900 font-medium">
              {ticket.assigned_technician?.name ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">AR Terms</span>
            <p className="text-gray-900 font-medium">
              {ticket.customers?.ar_terms ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-gray-500">PO Required</span>
            <p className="text-gray-900 font-medium">
              {ticket.customers?.po_required ? (
                <span className="text-red-700 font-bold">YES — PO REQUIRED</span>
              ) : (
                'No'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Action section */}
      <TicketActions
        ticket={ticket}
        userRole={user?.role ?? null}
        userId={user?.id ?? null}
        laborRate={laborRate}
      />
    </div>
  )
}
