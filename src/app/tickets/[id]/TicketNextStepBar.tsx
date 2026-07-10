'use client'

import { TicketDetail } from '@/lib/db/tickets'
import StatusBadge from '@/components/StatusBadge'
import StuckIndicator from '@/components/StuckIndicator'
import NextStepShell from '@/components/ui/NextStepShell'
import { deriveWorkflowProps } from '@/lib/workflow-status'

export interface TicketNextStepBarProps {
  ticket: TicketDetail
  isTech: boolean
  loading: boolean
  onStartWork: () => void
  onOpenSkipRequest: () => void
}

function scrollToPanel(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * PM detail's top-of-page status surface: one card instead of the old
 * WorkflowStatusCard + TicketActions pairing. Shows the status, the
 * next-actor/blocker context WorkflowStatusCard used to carry, and the ONE
 * primary next action for the current status. This is a surface, not a new
 * state machine: every action here calls the exact same handler the panel
 * below already uses (round 12 stage A, no transition/gate logic moves or
 * changes). Statuses with no single primary action (skipped, completed,
 * billed) show status context only; their Reopen options stay in the panel.
 */
export default function TicketNextStepBar({
  ticket,
  isTech,
  loading,
  onStartWork,
  onOpenSkipRequest,
}: TicketNextStepBarProps) {
  const { nextActor, blocker, enteredAt } = deriveWorkflowProps(ticket)

  return (
    <NextStepShell
      label="Next Step"
      description={blocker ?? nextActor}
    >
      <div className="flex items-center gap-3">
        <StatusBadge status={ticket.status} />
        <StuckIndicator enteredAt={enteredAt} state={ticket.status} />

        {(ticket.status === 'unassigned' || ticket.status === 'assigned') && (
          <button
            onClick={onStartWork}
            disabled={loading}
            className="px-5 py-3 text-sm font-semibold text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Starting...' : 'Start Work'}
          </button>
        )}

        {ticket.status === 'in_progress' && (
          <button
            type="button"
            onClick={() => scrollToPanel('pm-completion-form')}
            className="px-5 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[44px]"
          >
            Complete Job ↓
          </button>
        )}

        {ticket.status === 'skip_requested' && (
          isTech ? (
            <span className="text-sm text-gray-500 dark:text-gray-400">Awaiting manager review</span>
          ) : (
            <button
              type="button"
              onClick={() => scrollToPanel('pm-skip-request')}
              className="px-5 py-3 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors min-h-[44px]"
            >
              Review Skip Request ↓
            </button>
          )
        )}

        {isTech && (ticket.status === 'unassigned' || ticket.status === 'assigned') && (
          <button
            type="button"
            onClick={onOpenSkipRequest}
            disabled={loading}
            className="px-5 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Request Skip
          </button>
        )}
      </div>
    </NextStepShell>
  )
}
