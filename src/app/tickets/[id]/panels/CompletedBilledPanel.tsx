import type { ReactNode } from 'react'
import { TicketDetail } from '@/lib/db/tickets'
import { UserRole } from '@/types/database'
import ReadOnlyPhotos from '@/components/ReadOnlyPhotos'
import CompletionSuccessDialog from '@/components/CompletionSuccessDialog'
import { partLabel } from '@/lib/parts'
import { ACTIONS } from '@/lib/labels'

export interface CompletedBilledPanelProps {
  ticket: TicketDetail
  userRole: UserRole | null
  isTech: boolean
  laborRate: number
  isFlatRate: boolean
  flatRate: number | null
  loading: boolean
  error: string | null
  sharing: boolean
  workOrderFile: File | null
  onPrepareWorkOrder: () => void
  onShareWorkOrder: () => void
  onDownloadWorkOrder: () => void
  onReopen: (targetStatus: string) => void
  onConfirmReopen: (opts: { title: string; message: string; confirmLabel: string; targetStatus: string }) => void
  completed: boolean
  onViewWorkOrder: () => void
  superAdminOverride: ReactNode
  deleteButton: ReactNode
  confirmActionDialog: ReactNode
}

/**
 * Read-only completion summary for a completed/billed PM ticket, plus Share
 * Work Order and the manager-only Reopen controls. Mechanical extraction
 * from TicketActions.tsx (round 12 stage A); no logic changed, only moved.
 */
export default function CompletedBilledPanel({
  ticket,
  userRole,
  isTech,
  laborRate,
  isFlatRate,
  flatRate,
  loading,
  error,
  sharing,
  workOrderFile,
  onPrepareWorkOrder,
  onShareWorkOrder,
  onDownloadWorkOrder,
  onReopen,
  onConfirmReopen,
  completed,
  onViewWorkOrder,
  superAdminOverride,
  deleteButton,
  confirmActionDialog,
}: CompletedBilledPanelProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        Completion Details
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm mb-4">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Completed Date</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.completed_date
              ? new Date(ticket.completed_date).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Hours Worked</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.hours_worked ?? '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Billing Amount</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.billing_amount != null
              ? `$${ticket.billing_amount.toFixed(2)}`
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Billing Exported</span>
          <p className="text-gray-900 dark:text-white font-medium">
            {ticket.billing_exported ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      {/* PM Service Section (read-only) */}
      {ticket.parts_used && ticket.parts_used.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-3 mb-3">
          <h3 className="text-xs font-semibold text-blue-800 dark:text-blue-300 uppercase tracking-wide mb-2">
            PM Service — Covered Under Agreement
          </h3>
          <div className="space-y-1">
            {ticket.parts_used.map((part, i) => (
              <div key={`ro-pm-${i}`} className="text-sm text-gray-900 dark:text-white">
                {partLabel(part)} — Qty: {part.quantity}
              </div>
            ))}
          </div>
          {isFlatRate && flatRate != null && (
            <div className="flex justify-between mt-2 pt-2 border-t border-blue-200 dark:border-blue-800 text-sm font-semibold text-blue-800 dark:text-blue-300">
              <span>PM Service — Flat Rate</span>
              <span>${flatRate.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Additional Work Section (read-only) */}
      {((ticket.additional_parts_used && ticket.additional_parts_used.length > 0) || (ticket.additional_hours_worked && ticket.additional_hours_worked > 0)) && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-3 mb-3">
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">
            Additional Work — Not Covered Under Agreement
          </h3>
          {ticket.additional_hours_worked != null && ticket.additional_hours_worked > 0 && (
            <div className="text-sm text-gray-900 dark:text-white mb-1">
              Additional Labor: {ticket.additional_hours_worked} hrs
              {` @ $${laborRate.toFixed(2)}/hr = $${(ticket.additional_hours_worked * laborRate).toFixed(2)}`}
            </div>
          )}
          {ticket.additional_parts_used && ticket.additional_parts_used.length > 0 && (
            <div className="space-y-1">
              {ticket.additional_parts_used.map((part, i) => (
                <div key={`ro-addl-${i}`} className="text-sm text-gray-900 dark:text-white">
                  {partLabel(part)} — Qty: {part.quantity}
                  {` @ $${part.unit_price.toFixed(2)} = $${(part.quantity * part.unit_price).toFixed(2)}`}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 text-sm font-semibold text-amber-900 dark:text-amber-300">
            <span>Additional Work Subtotal</span>
            <span>
              ${(
                ((ticket.additional_hours_worked ?? 0) * laborRate) +
                (ticket.additional_parts_used ?? []).reduce((s, p) => s + p.quantity * p.unit_price, 0)
              ).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Trip Charge (read-only) — derived from the stored total so it always
          reconciles with billing_amount and the work-order PDF. */}
      {ticket.billing_amount != null && (() => {
        const roPmSubtotal = isFlatRate && flatRate != null ? flatRate : 0
        const roAdditionalSubtotal =
          ((ticket.additional_hours_worked ?? 0) * laborRate) +
          (ticket.additional_parts_used ?? []).reduce((s, p) => s + p.quantity * p.unit_price, 0)
        const roTripCharge = Math.max(0, ticket.billing_amount - roPmSubtotal - roAdditionalSubtotal)
        return roTripCharge > 0 ? (
          <div className="flex justify-between mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            <span>Trip Charge</span>
            <span>${roTripCharge.toFixed(2)}</span>
          </div>
        ) : null
      })()}

      {/* Grand Total (read-only) */}
      {ticket.billing_amount != null && (
        <div className="rounded-lg bg-gray-900 px-4 py-3 flex items-center justify-between mb-1">
          <span className="text-base font-bold text-white">Grand Total</span>
          <span className="text-lg font-bold text-white">${ticket.billing_amount.toFixed(2)}</span>
        </div>
      )}
      {ticket.billing_amount != null && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-right mb-3">Taxes not included</p>
      )}

      {ticket.completion_notes && (
        <div className="mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Notes</span>
          <p className="text-sm text-gray-900 dark:text-white mt-1 whitespace-pre-wrap">
            {ticket.completion_notes}
          </p>
        </div>
      )}
      {ticket.photos && ticket.photos.length > 0 && (
        <ReadOnlyPhotos photos={ticket.photos} />
      )}
      {ticket.customer_signature && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">Customer Signature</span>
          <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 p-2 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ticket.customer_signature}
              alt="Customer signature"
              className="h-20 w-auto"
            />
          </div>
          {ticket.customer_signature_name && (
            <p className="text-sm text-gray-900 dark:text-white font-medium mt-1">
              {ticket.customer_signature_name}
            </p>
          )}
        </div>
      )}
      {/* Share Work Order — visible to all roles on completed/billed tickets */}
      <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
        {!workOrderFile ? (
          <button
            onClick={onPrepareWorkOrder}
            disabled={sharing}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {sharing ? 'Generating...' : 'Share Work Order'}
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={onShareWorkOrder}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px]"
            >
              Share
            </button>
            <button
              onClick={onDownloadWorkOrder}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 dark:text-gray-300 bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
            >
              Download
            </button>
            <span className="text-sm text-green-600">Ready</span>
          </div>
        )}
      </div>
      {ticket.status === 'completed' && !isTech && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={() => onReopen('in_progress')}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Reopening...' : 'Reopen Ticket'}
          </button>
        </div>
      )}
      {ticket.status === 'billed' && (userRole === 'super_admin' || userRole === 'manager') && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Manager: Reopen ticket status</p>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onConfirmReopen({ title: 'Reopen to Completed?', message: 'Reopen this ticket to Completed? Billing export flag will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'completed' })}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Reopen to Completed
            </button>
            <button
              onClick={() => onConfirmReopen({ title: 'Reopen to In Progress?', message: 'Reopen this ticket to In Progress? All completion data will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'in_progress' })}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Reopen to In Progress
            </button>
            <button
              onClick={() => onConfirmReopen({ title: 'Reopen to Assigned?', message: 'Reopen this ticket to Assigned? All completion data will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'assigned' })}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Reopen to Assigned
            </button>
            <button
              onClick={() => onConfirmReopen({ title: 'Reopen to Unassigned?', message: 'Reopen this ticket to Unassigned? All data including technician assignment will be cleared.', confirmLabel: ACTIONS.reopen, targetStatus: 'unassigned' })}
              disabled={loading}
              className="px-3 py-2 text-xs font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors"
            >
              Reopen to Unassigned
            </button>
          </div>
        </div>
      )}
      {superAdminOverride}
      {deleteButton}
      {confirmActionDialog}
      <CompletionSuccessDialog
        open={completed}
        ticketsHref="/tickets"
        ticketsLabel="Back to Tickets"
        onViewWorkOrder={onViewWorkOrder}
      />
    </div>
  )
}
