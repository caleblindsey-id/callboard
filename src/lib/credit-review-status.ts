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

// The status to DISPLAY as a badge on list rows. Like activeCreditReviewStatus
// but also surfaces a `released` order (green "cleared by AR" confirmation). An
// active review (pending/blocked) wins over a released one. Null = no badge.
export function displayCreditReviewStatus(
  reviews: { status: CreditReviewStatus }[] | null | undefined
): 'pending' | 'blocked' | 'released' | null {
  const list = reviews ?? []
  const active = list.find((r) => r.status === 'pending' || r.status === 'blocked')
  if (active) return active.status as 'pending' | 'blocked'
  if (list.some((r) => r.status === 'released')) return 'released'
  return null
}
