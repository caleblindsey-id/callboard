import type { TicketStatus } from '@/types/database'
import StatusBadge from '@/components/StatusBadge'

// Soft threshold: states older than this surface a "stuck" warning in amber.
// Tuned to 48h so an overnight + business-day round-trip doesn't trip it,
// but a ticket truly parked for the weekend does.
//
// Exported so list views (e.g. the kanban board) can apply the same gate when
// rendering a compact "in state for X days" indicator — keep one source of truth.
export const STUCK_THRESHOLD_HOURS = 48

/**
 * Days elapsed since `enteredAt`. Returns null if `enteredAt` is missing or
 * malformed. The 48h threshold uses raw hours; rendering uses whole days for
 * a cleaner display ("in state for 3 days").
 */
function daysInState(enteredAt: string | undefined): number | null {
  if (!enteredAt) return null
  const entered = new Date(enteredAt).getTime()
  if (Number.isNaN(entered)) return null
  const now = Date.now()
  const hours = (now - entered) / (1000 * 60 * 60)
  if (hours < 0) return 0
  return Math.floor(hours / 24)
}

function hoursInState(enteredAt: string | undefined): number | null {
  if (!enteredAt) return null
  const entered = new Date(enteredAt).getTime()
  if (Number.isNaN(entered)) return null
  return (Date.now() - entered) / (1000 * 60 * 60)
}

export interface WorkflowStatusCardProps {
  /**
   * Status string. Where it matches a known `TicketStatus`, the badge is
   * rendered via `<StatusBadge>` for visual consistency with ticket boards.
   * Any other string (e.g. tech-lead workflow states) falls back to a neutral
   * pill so this component stays useful for non-ticket workflows.
   */
  state: string
  /** "Next: {nextActor} {action verb}" line. Optional. */
  nextActor?: string
  /** Red-text blocker line. Optional. */
  blocker?: string
  /** ISO timestamp the state was entered. Drives the "stuck" warning. */
  enteredAt?: string
}

// Statuses also defined in StatusBadge — keep this in sync if new statuses
// are added there.
const KNOWN_STATUSES = new Set<TicketStatus>([
  'unassigned',
  'assigned',
  'in_progress',
  'completed',
  'billed',
  'skipped',
  'skip_requested',
])

function isTicketStatus(value: string): value is TicketStatus {
  return KNOWN_STATUSES.has(value as TicketStatus)
}

export default function WorkflowStatusCard({
  state,
  nextActor,
  blocker,
  enteredAt,
}: WorkflowStatusCardProps) {
  const hours = hoursInState(enteredAt)
  const days = daysInState(enteredAt)
  const isStuck = hours !== null && hours >= STUCK_THRESHOLD_HOURS

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
      <div className="flex items-center gap-2">
        {isTicketStatus(state) ? (
          <StatusBadge status={state} />
        ) : (
          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            {state}
          </span>
        )}
        {days !== null && (
          <span
            className={
              isStuck
                ? 'text-xs text-amber-700 dark:text-amber-400 font-medium'
                : 'text-xs text-gray-500 dark:text-gray-400'
            }
          >
            {days === 0 ? 'today' : `in state for ${days} day${days === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {nextActor && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-medium">Next:</span> {nextActor}
        </p>
      )}

      {blocker && (
        <p className="text-sm text-red-700 dark:text-red-400">
          <span className="font-medium">Blocked:</span> {blocker}
        </p>
      )}
    </div>
  )
}
