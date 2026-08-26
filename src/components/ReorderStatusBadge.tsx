import type { ReorderLineRow, ReorderSessionStatus } from '@/types/reorder'
import type { ReorderUrgency } from '@/lib/reorder/suggest'
import Badge from '@/components/ui/Badge'

// Thin wrapper over Badge + status-meta.ts (the 'reorder' domain), mirroring
// StatusBadge.tsx's pattern for PM tickets — one import to change if the
// session-status domain key ever moves.
export default function ReorderStatusBadge({ status }: { status: ReorderSessionStatus }) {
  return <Badge domain="reorder" status={status} />
}

// Per-line urgency is a computed inventory-health signal recomputed from the
// snapshotted reorder_lines fields, not a real DB enum — same reasoning
// OverdueBadge (in StatusBadge.tsx) uses to stay outside status-meta.ts. Kept
// here (not status-meta) because it also needs a solid "dot" swatch for the
// card-mode color strip, a shape status-meta's pill-only StatusMeta doesn't carry.
export const URGENCY_META: Record<ReorderUrgency, { label: string; pillClasses: string; dotClasses: string }> = {
  red: {
    label: 'Below reorder point',
    pillClasses: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    dotClasses: 'bg-red-500',
  },
  amber: {
    label: 'Getting low',
    pillClasses: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    dotClasses: 'bg-amber-500',
  },
  green: {
    label: 'Healthy',
    pillClasses: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    dotClasses: 'bg-green-500',
  },
  grey: {
    label: 'No recent usage',
    pillClasses: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    dotClasses: 'bg-gray-400 dark:bg-gray-500',
  },
}

export function UrgencyDot({ urgency, className = '' }: { urgency: ReorderUrgency; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 rounded-full shrink-0 ${URGENCY_META[urgency].dotClasses} ${className}`.trim()}
    />
  )
}

export function UrgencyBadge({ urgency, className = '' }: { urgency: ReorderUrgency; className?: string }) {
  const meta = URGENCY_META[urgency]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.pillClasses} ${className}`.trim()}
    >
      <UrgencyDot urgency={urgency} />
      {meta.label}
    </span>
  )
}

// Per-line urgency computed from the PERSISTED reorder_lines snapshot fields —
// distinct from suggest.ts's urgency (computed at session-creation time from
// raw inv_reorder inputs, which aren't available once snapshotted). Mirrors
// suggest.ts's formula exactly (targetWeeksOfSupply hardcoded to its default of
// 6) so a line's on-screen urgency can never disagree with the suggested_qty
// that was computed for it.
export function reorderUrgency(
  line: Pick<ReorderLineRow, 'weekly_usage' | 'available' | 'order_point' | 'weeks_of_supply'>
): ReorderUrgency {
  const weeklyUsage = line.weekly_usage ?? 0
  const available = line.available ?? 0
  const orderPoint = line.order_point ?? 0
  const weeksOfSupply = line.weeks_of_supply

  if (weeklyUsage <= 0 && available > 0) return 'grey'
  if (available <= 0 || (orderPoint > 0 && available <= orderPoint)) return 'red'
  if (weeksOfSupply != null && weeksOfSupply < 6) return 'amber'
  return 'green'
}
