import type { ServiceTicketType } from '@/types/service-tickets'

// Inside (bench) vs outside (field service) badge. Shared so the service board
// and the billing queues render the same labels and colors. Distinct from the
// billing-type label (T&M/Warranty) shown elsewhere on the billing page.
const TICKET_TYPE_CONFIG: Record<ServiceTicketType, { label: string; classes: string }> = {
  inside: {
    label: 'Inside',
    classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  outside: {
    label: 'Outside',
    classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  },
}

export default function TicketTypeBadge({ type }: { type: ServiceTicketType }) {
  const c = TICKET_TYPE_CONFIG[type]
  if (!c) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.classes}`}>
      {c.label}
    </span>
  )
}
