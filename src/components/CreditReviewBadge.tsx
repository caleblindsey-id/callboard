import type { CreditReviewStatus } from '@/types/database'
import Badge from '@/components/ui/Badge'

// Per-ORDER credit review state. Distinct from CreditHoldBadge, which reflects
// the customer-level (sync-owned) credit_hold flag. Thin wrapper over Badge +
// status-meta.ts (the 'creditReview' domain).
export default function CreditReviewBadge({ status }: { status: CreditReviewStatus }) {
  return <Badge domain="creditReview" status={status} />
}
