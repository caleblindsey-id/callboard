import type { CreditReviewStatus } from '@/types/database'

// Pure helper (no server imports) so it's safe to use in client components.
// The active per-order credit review status (pending/blocked), or null when the
// order isn't credit-gated. Released reviews are treated as not-gated.
export function activeCreditReviewStatus(
  reviews: { status: CreditReviewStatus }[] | null | undefined
): 'pending' | 'blocked' | null {
  const open = (reviews ?? []).find((r) => r.status === 'pending' || r.status === 'blocked')
  return (open?.status as 'pending' | 'blocked') ?? null
}
