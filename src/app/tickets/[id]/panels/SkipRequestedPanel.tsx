import type { ReactNode } from 'react'
import { TicketDetail } from '@/lib/db/tickets'
import SkipDialog from '../../SkipDialog'
import { skipReasonLabel, isStopReason } from '@/lib/skip-reasons'
import { formatMonthYear } from '@/lib/utils/schedule'

export interface SkipRequestedPanelProps {
  ticket: TicketDetail
  isTech: boolean
  error: string | null
  loading: boolean
  skipDialogOpen: boolean
  onOpenSkipDialog: () => void
  onCloseSkipDialog: () => void
  onSkipDialogDone: () => void
  onDenySkip: () => void
  superAdminOverride: ReactNode
  deleteButton: ReactNode
  confirmActionDialog: ReactNode
}

/**
 * Panel for a PM ticket in 'skip_requested': shows the tech's structured
 * skip request and, for staff, Approve Skip / Deny Skip. Mechanical
 * extraction from TicketActions.tsx (round 12 stage A); no logic changed,
 * only moved.
 */
export default function SkipRequestedPanel({
  ticket,
  isTech,
  error,
  loading,
  skipDialogOpen,
  onOpenSkipDialog,
  onCloseSkipDialog,
  onSkipDialogDone,
  onDenySkip,
  superAdminOverride,
  deleteButton,
  confirmActionDialog,
}: SkipRequestedPanelProps) {
  return (
    <>
      <div id="pm-skip-request" className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-4">
          Skip Requested
        </h2>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {/* Structured skip request (legacy rows show only the free-text reason) */}
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-md p-3 mb-4 border border-amber-200 dark:border-amber-800 space-y-2">
          {ticket.skip_reason_category ? (
            <>
              <div>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Reason</p>
                <p className="text-sm text-gray-900 dark:text-white">{skipReasonLabel(ticket.skip_reason_category)}</p>
              </div>
              {ticket.skip_equipment_on_site !== null && (
                <div>
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Equipment still on site</p>
                  <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_equipment_on_site ? 'Yes' : 'No'}</p>
                </div>
              )}
              {ticket.skip_recommended_month && (
                <div>
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Customer&apos;s requested next PM</p>
                  <p className="text-sm text-gray-900 dark:text-white">{formatMonthYear(ticket.skip_recommended_month, ticket.skip_recommended_year)}</p>
                </div>
              )}
              {ticket.skip_reason && (
                <div>
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Notes</p>
                  <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_reason}</p>
                </div>
              )}
            </>
          ) : (
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Reason</p>
              <p className="text-sm text-gray-900 dark:text-white">{ticket.skip_reason || '—'}</p>
            </div>
          )}
        </div>

        {isTech ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your skip request has been submitted and is waiting for manager approval.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onOpenSkipDialog}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              Approve Skip
            </button>
            <button
              onClick={onDenySkip}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Denying...' : 'Deny Skip'}
            </button>
          </div>
        )}
        {superAdminOverride}
        {deleteButton}
        {confirmActionDialog}
      </div>

      {skipDialogOpen && (
        <SkipDialog
          tickets={[{
            id: ticket.id,
            month: ticket.month,
            year: ticket.year,
            work_order_number: ticket.work_order_number,
            customers: ticket.customers ? { name: ticket.customers.name } : null,
            equipment: ticket.equipment
              ? { make: ticket.equipment.make, model: ticket.equipment.model }
              : null,
            // TicketDetail exposes the schedule join as `schedule` (different
            // shape than the listing's `pm_schedules`); SkipDialog needs the
            // listing shape so we map it explicitly.
            pm_schedules: ticket.schedule
              ? { interval_months: ticket.schedule.interval_months, anchor_month: ticket.schedule.anchor_month }
              : null,
          }]}
          recommendedMonth={ticket.skip_recommended_month ?? undefined}
          recommendedYear={ticket.skip_recommended_year ?? undefined}
          suggestStop={isStopReason(ticket.skip_reason_category) || ticket.skip_equipment_on_site === false}
          onClose={onCloseSkipDialog}
          onDone={onSkipDialogDone}
        />
      )}
    </>
  )
}
