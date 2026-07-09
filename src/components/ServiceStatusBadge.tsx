import type { ServiceTicketStatus } from '@/types/service-tickets'
import Badge from '@/components/ui/Badge'
import { STATUS_META } from '@/lib/status-meta'

// Thin wrapper over Badge + status-meta.ts (the 'service' domain). Preserves
// the original component's defensive null-render for a status value that
// somehow isn't in the enum (bad/legacy data) rather than showing a fallback pill.
export default function ServiceStatusBadge({ status }: { status: ServiceTicketStatus }) {
  if (!(status in STATUS_META.service)) return null
  return <Badge domain="service" status={status} />
}
