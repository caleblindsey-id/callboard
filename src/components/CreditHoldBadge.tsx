import Badge from '@/components/ui/Badge'

// Customer-level (sync-owned) credit_hold flag. Distinct from
// CreditReviewBadge, which reflects per-order review state. Thin wrapper over
// Badge + status-meta.ts (the 'creditHold' domain, a single static key since
// there's no real enum backing this flag).
export default function CreditHoldBadge() {
  return <Badge domain="creditHold" status="active" />
}
