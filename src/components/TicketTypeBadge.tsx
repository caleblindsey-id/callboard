import type { ServiceTicketType } from '@/types/service-tickets'
import Badge from '@/components/ui/Badge'
import { STATUS_META } from '@/lib/status-meta'

// Inside (bench) vs outside (field service) badge. Shared so the service board
// and the billing queues render the same labels and colors. Distinct from the
// billing-type label (T&M/Warranty) shown elsewhere on the billing page. Thin
// wrapper over Badge + status-meta.ts (the 'ticketType' domain).
export default function TicketTypeBadge({ type }: { type: ServiceTicketType }) {
  if (!(type in STATUS_META.ticketType)) return null
  return <Badge domain="ticketType" status={type} />
}
