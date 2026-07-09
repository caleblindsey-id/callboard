import type { MyPartStatus } from '@/lib/db/parts-queue'
import Badge from '@/components/ui/Badge'
import { STATUS_META } from '@/lib/status-meta'

// Thin wrapper over Badge + status-meta.ts (the 'parts' domain). MyPartStatus
// is a subset of status-meta's PartsStatusKey (it never carries the derived
// 'pulled' key — see status-meta.ts), so every MyPartStatus value resolves.
// Label wording note: this now renders the canonical parts vocabulary
// ("In Review" / "Requested" / "Ordered" / "Received" / "From Stock") instead
// of the friendlier tech-facing copy this component used to show on its own
// ("Awaiting Order", "On Order", "Ready for Pickup") — flagged in the round-3
// report, not a silent change.
export default function PartsStatusBadge({ status }: { status: MyPartStatus }) {
  if (!(status in STATUS_META.parts)) return null
  return <Badge domain="parts" status={status} />
}
