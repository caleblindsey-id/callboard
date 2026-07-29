import type { CreditReviewStatus } from '@/types/database'
import { activeCreditReviewStatus } from '@/lib/credit-review-status'
import { SERVICE_STATUS } from '@/lib/constants/service-status'

/**
 * What the board's readiness chip shows for one row, or null for no chip.
 *
 * The Approved tab is the dispatch queue and its one question per ticket is
 * "can this actually be started?" (feedback #79). The board could not answer it,
 * so managers opened tickets one at a time. This is that answer, derived from
 * data already on the row.
 */
export type ReadinessChip =
  | { kind: 'waiting'; pending: number; total: number }
  | { kind: 'credit'; status: Extract<CreditReviewStatus, 'pending' | 'blocked'> }
  | { kind: 'ready' }
  | null

export type ReadinessInput = {
  status: string
  parts_pending?: number
  parts_total?: number
  credit_reviews: { status: CreditReviewStatus }[] | null
}

/**
 * Decide the chip. Pure, so the precedence is testable without a board.
 *
 * Order matters and is not arbitrary:
 *
 * 1. Only approved / in_progress rows get a chip at all. Earlier stages have no
 *    trustworthy part counts — the parts_order_queue view hides untriaged parts
 *    while an estimate is still open (migration 102) — and later stages have
 *    nothing left to dispatch.
 * 2. Missing counts yield no chip rather than a green one. Claiming "Ready" from
 *    absent data is the one failure mode worse than showing nothing, since the
 *    whole point is to be trusted at a glance.
 * 3. Parts outrank credit. A ticket blocked on both shows the parts chip,
 *    because credit already renders its own badge beside the customer name while
 *    the parts blocker is invisible anywhere else on the row.
 * 4. In Progress gets the amber chip only. "Ready" on work already underway is
 *    noise; a tech stalled mid-job is the signal worth surfacing.
 */
export function resolveReadinessChip(ticket: ReadinessInput): ReadinessChip {
  const isApproved = ticket.status === SERVICE_STATUS.APPROVED
  const isInProgress = ticket.status === SERVICE_STATUS.IN_PROGRESS
  if (!isApproved && !isInProgress) return null

  if (ticket.parts_pending === undefined || ticket.parts_total === undefined) return null

  if (ticket.parts_pending > 0) {
    return { kind: 'waiting', pending: ticket.parts_pending, total: ticket.parts_total }
  }

  if (isInProgress) return null

  // Only an OPEN review gates the work — a released one has already been cleared
  // by AR, so it must not suppress the green chip.
  const credit = activeCreditReviewStatus(ticket.credit_reviews)
  if (credit) return { kind: 'credit', status: credit }

  return { kind: 'ready' }
}

/** The chip's text. Mirrors the detail page's "(N of M still pending)" phrasing. */
export function readinessChipLabel(chip: NonNullable<ReadinessChip>): string {
  if (chip.kind === 'waiting') return `Parts ${chip.pending} of ${chip.total}`
  return ''
}

/**
 * Sort rank for the readiness column: blocked work first, then credit-gated,
 * then startable, then rows with no chip. Sorting a dispatch queue by "what
 * can't go" ascending is the least useful order, so the ranks put the actionable
 * answer at one end and the noise at the other.
 */
export function readinessSortRank(chip: ReadinessChip): number {
  if (!chip) return 3
  if (chip.kind === 'waiting') return 0
  if (chip.kind === 'credit') return 1
  return 2
}
