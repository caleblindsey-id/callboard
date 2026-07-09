'use client'

import { SERVICE_STATUS } from '@/lib/constants/service-status'
import { SynergyNumberField } from './detail-ui'
import NextStepShell from '@/components/ui/NextStepShell'
import type { ServiceTicketDetail as ServiceTicketDetailType } from '@/types/service-tickets'

interface NextStepBarProps {
  ticket: ServiceTicketDetailType
  isManager: boolean
  isStaff: boolean
  isTech: boolean
  loading: boolean
  isWarrantyOpen: boolean
  partsBlocking: boolean
  // Form-open flags — owned by the parent (the estimate builder and
  // completion form live in their own cards below; the buttons here open them)
  showEstimateForm: boolean
  setShowEstimateForm: (open: boolean) => void
  showCompletionForm: boolean
  setShowCompletionForm: (open: boolean) => void
  setBypassOpen: (open: boolean) => void
  setRequestInfoOpen: (open: boolean) => void
  // Inline approve/decline note flow (estimated state)
  manualDecisionMode: null | 'approve' | 'decline'
  setManualDecisionMode: (mode: null | 'approve' | 'decline') => void
  manualDecisionNote: string
  setManualDecisionNote: (note: string) => void
  // Completed-state billing
  synergyInvoiceNumber: string
  // Actions — all mutate shared ticket state, so they live in the parent
  onStartWork: () => Promise<void>
  onApproveEstimate: (note: string) => Promise<void>
  onDeclineEstimate: (note: string) => Promise<void>
  onSaveSynergyInvoiceNumber: (value: string) => Promise<void>
  onMarkBilled: () => Promise<void>
}

/**
 * Next Step bar — one contextual primary lifecycle action per stage (start
 * work, build/bypass estimate, approve/decline with required note, complete,
 * record invoice # + mark billed). Extracted verbatim from ServiceTicketDetail
 * (audit P3 refactor, round 5). The `viewerHasPrimaryAction &&
 * !showMobileActionBar` render gate stays in the parent, as does all state.
 */
export default function NextStepBar({
  ticket,
  isManager,
  isStaff,
  isTech,
  loading,
  isWarrantyOpen,
  partsBlocking,
  showEstimateForm,
  setShowEstimateForm,
  showCompletionForm,
  setShowCompletionForm,
  setBypassOpen,
  setRequestInfoOpen,
  manualDecisionMode,
  setManualDecisionMode,
  manualDecisionNote,
  setManualDecisionNote,
  synergyInvoiceNumber,
  onStartWork,
  onApproveEstimate,
  onDeclineEstimate,
  onSaveSynergyInvoiceNumber,
  onMarkBilled,
}: NextStepBarProps) {
  return (
    <NextStepShell label="Next Step">
      {/* Open + warranty/partial → skip the estimate, start work */}
      {isWarrantyOpen && (
        <button
          onClick={onStartWork}
          disabled={loading}
          className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Starting...' : 'Start Work'}
        </button>
      )}

      {/* Open + non-warranty → build / revise the estimate (opens builder below),
          or skip the estimate entirely when the work is already authorized. */}
      {ticket.status === SERVICE_STATUS.OPEN && !isWarrantyOpen && !showEstimateForm && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <button
            onClick={() => setShowEstimateForm(true)}
            className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-yellow-600 rounded-md hover:bg-yellow-700 transition-colors min-h-[44px]"
          >
            {ticket.estimate_amount != null ? 'Revise Estimate' : 'Build Estimate'}
          </button>
          <button
            onClick={() => setBypassOpen(true)}
            disabled={loading}
            className="w-full sm:w-auto px-5 py-3 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Start work — no estimate
          </button>
        </div>
      )}

      {/* Estimated → approve / decline / request more info. Staff get all
          three; technicians get Approve only (decline stays staff-only,
          request-more-info is manager-only below). Both commit paths require
          a note (who told us / why), shown via an inline-expand textarea
          before committing. */}
      {ticket.status === SERVICE_STATUS.ESTIMATED && (isStaff || isTech) && (
        manualDecisionMode === null ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setManualDecisionMode('approve')
                setManualDecisionNote('')
              }}
              disabled={loading}
              className="px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              Approve Estimate
            </button>
            {isStaff && (
              <button
                onClick={() => {
                  setManualDecisionMode('decline')
                  setManualDecisionNote('')
                }}
                disabled={loading}
                className="px-5 py-3 text-sm font-medium text-red-700 dark:text-red-400 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Decline
              </button>
            )}
            {isManager && (
              <button
                onClick={() => setRequestInfoOpen(true)}
                disabled={loading}
                className="px-5 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-white dark:bg-gray-700 border border-amber-300 dark:border-amber-600 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Request More Info
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-w-lg">
            <label htmlFor="manual-decision-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {manualDecisionMode === 'approve'
                ? 'Who told us to approve? (required)'
                : 'Why are we declining? (required for the record)'}
            </label>
            <textarea
              id="manual-decision-note"
              autoFocus
              value={manualDecisionNote}
              onChange={(e) => setManualDecisionNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={manualDecisionMode === 'approve'
                ? 'e.g. Spoke with John Smith on phone 4/29 — approved verbally'
                : 'e.g. Customer chose another vendor — confirmed by email 4/29'}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const note = manualDecisionNote.trim()
                  if (manualDecisionMode === 'approve') {
                    onApproveEstimate(note)
                  } else {
                    onDeclineEstimate(note)
                  }
                }}
                disabled={loading || manualDecisionNote.trim().length < 2}
                className={`px-5 py-3 text-sm font-semibold text-white rounded-md disabled:opacity-50 transition-colors min-h-[44px] ${
                  manualDecisionMode === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {loading
                  ? (manualDecisionMode === 'approve' ? 'Approving...' : 'Declining...')
                  : (manualDecisionMode === 'approve' ? 'Confirm Approve' : 'Confirm Decline')}
              </button>
              <button
                onClick={() => {
                  setManualDecisionMode(null)
                  setManualDecisionNote('')
                }}
                disabled={loading}
                className="px-5 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )
      )}

      {/* Approved → start work (the parts-blocked case shows on the status card) */}
      {ticket.status === SERVICE_STATUS.APPROVED && !partsBlocking && (
        <button
          onClick={onStartWork}
          disabled={loading}
          className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Starting...' : 'Start Work'}
        </button>
      )}

      {/* In progress → complete the job (opens completion form below), plus
          an escape hatch on a "started without an estimate" (bypassed) ticket
          to add a real estimate after the fact. Building the estimate flips
          the ticket back to the estimate/approval flow without losing the
          diagnosis, photos, or started_at already captured. Hidden while
          either form is open. */}
      {ticket.status === SERVICE_STATUS.IN_PROGRESS && !showCompletionForm && !showEstimateForm && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <button
            onClick={() => setShowCompletionForm(true)}
            className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[44px]"
          >
            Complete Job
          </button>
          {ticket.estimate_bypassed && (
            <button
              onClick={() => {
                setShowCompletionForm(false)
                setShowEstimateForm(true)
              }}
              className="w-full sm:w-auto px-5 py-3 text-sm font-medium text-yellow-700 dark:text-yellow-400 bg-white dark:bg-gray-700 border border-yellow-400 dark:border-yellow-600 rounded-md hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors min-h-[44px]"
            >
              Build Estimate
            </button>
          )}
        </div>
      )}

      {/* Completed + staff → record Synergy invoice #, then bill */}
      {ticket.status === SERVICE_STATUS.COMPLETED && isStaff && (
        <div className="space-y-2">
          <SynergyNumberField
            initialValue={synergyInvoiceNumber}
            onSave={onSaveSynergyInvoiceNumber}
            loading={loading}
            heading="Synergy Billing"
            fieldLabel="Invoice #"
          />
          {!synergyInvoiceNumber.trim() && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Enter and save the Synergy Invoice # above before billing.
            </p>
          )}
          <button
            onClick={onMarkBilled}
            disabled={loading || !synergyInvoiceNumber.trim()}
            className="w-full sm:w-auto px-5 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Saving...' : 'Mark Billed'}
          </button>
        </div>
      )}
    </NextStepShell>
  )
}
