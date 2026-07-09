import { TicketStatus } from '@/types/database'
import Badge from '@/components/ui/Badge'

const badgeBase =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium'

const overdueClasses =
  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'

// Thin wrapper over Badge + status-meta.ts (the 'pm' domain). Kept as a named
// component (rather than inlining Badge at every call site) so PM ticket
// status keeps one import to change if the domain key ever moves.
export default function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge domain="pm" status={status} />
}

// Not status-driven (no enum value backs "overdue" — it's a computed days-late
// flag), so it stays a standalone pill rather than going through status-meta.
export function OverdueBadge({ days }: { days: number }) {
  const suffix = days > 0 ? ` · ${days}d` : ''
  return (
    <span className={`${badgeBase} ${overdueClasses}`}>
      OVERDUE{suffix}
    </span>
  )
}
