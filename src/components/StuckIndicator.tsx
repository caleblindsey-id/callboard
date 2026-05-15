import { STUCK_THRESHOLD_HOURS } from '@/components/WorkflowStatusCard'

interface StuckIndicatorProps {
  /** ISO timestamp the current state was entered. Indicator hides if absent. */
  enteredAt?: string
  /** State name (used in the tooltip — "X days in {state}"). */
  state: string
}

// Helper kept outside the component so the lint rule treats Date.now() as
// isolated (matches how WorkflowStatusCard scopes its time-of-render logic).
function computeStuck(enteredAt: string | undefined): { stuck: boolean; days: number } {
  if (!enteredAt) return { stuck: false, days: 0 }
  const entered = new Date(enteredAt).getTime()
  if (Number.isNaN(entered)) return { stuck: false, days: 0 }
  const hours = (Date.now() - entered) / (1000 * 60 * 60)
  return { stuck: hours >= STUCK_THRESHOLD_HOURS, days: Math.floor(hours / 24) }
}

/**
 * Tiny amber dot for ticket board rows that have been parked in their current
 * state past `STUCK_THRESHOLD_HOURS`. Full `<WorkflowStatusCard>` is overkill
 * for a row; this is the compact form.
 */
export default function StuckIndicator({ enteredAt, state }: StuckIndicatorProps) {
  const { stuck, days } = computeStuck(enteredAt)
  if (!stuck) return null

  const label = `${days} day${days === 1 ? '' : 's'} in ${state.replace(/_/g, ' ')}`
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-block h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400"
    />
  )
}
