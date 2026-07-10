import type {
  AceLaborStatus,
  CreditReviewStatus,
  PartRequestStatus,
  SupplyRequestStatus,
  TechLeadStatus,
  TicketStatus,
} from '@/types/database'
import type { ServiceTicketStatus, ServiceTicketType } from '@/types/service-tickets'

/**
 * status-meta.ts — the single source of truth for status LABEL + COLOR across
 * CallBoard, keyed by (domain, status). This is the "one status word, one
 * color" fix from the UX standardization audit (standard-draft.md dimensions
 * 13 + 18): six badge components used to redeclare the same pill class and
 * disagree on color for the same concept (in_progress orange in one place,
 * blue in another). Every badge in the app should resolve its label + classes
 * from here, never hardcode its own.
 *
 * Cross-domain color unification (deliberate, not incidental):
 *   - in_progress -> BLUE in every domain that has it (pm, service)
 *   - completed   -> GREEN in every domain that has it (pm, service)
 *   - billed      -> PURPLE in every domain that has it (pm, service)
 *   - terminal-negative (declined/rejected/cancelled/canceled/skipped/expired)
 *     -> RED for an outcome still worth following up on (declined, rejected),
 *        GRAY for a fully inert/closed state (cancelled, canceled, skipped,
 *        expired). This split already matched every existing badge, so no
 *        color changed here — noted for the next person who wonders why.
 * Every other status is domain-specific vocabulary (e.g. "open" vs "approved"
 * vs "pending") and is NOT forced to match a same-named status in another
 * domain — the words mean different things in different pipelines.
 */

export interface StatusMeta {
  label: string
  classes: string
}

// Derived, not a real DB enum value: a from_stock part becomes "Pulled" once
// pulled_at is set (see PartRequestStatus in src/types/database.ts and
// isPulledStock() in PartsQueueClient.tsx). Kept here so a future caller can
// render it through Badge without inventing its own pill; nothing wires this
// key up yet — see the round-3 report for why.
export type PartsStatusKey = PartRequestStatus | 'pulled'

// CreditHoldBadge has no real status enum — it is a static "the flag is on"
// pill. Modeled as a single-key domain so it can still go through Badge.
export type CreditHoldStatusKey = 'active'

// Shared pill shape (no sizing — Badge.tsx layers in size-specific padding/
// text classes so it can offer a size prop without a class collision).
export const BADGE_BASE = 'inline-flex items-center rounded-full font-medium'

// ---------------------------------------------------------------------------
// Shared color tokens for the cross-domain unification above. Reused by name
// (not just by value) so the intent reads at the call site.
// ---------------------------------------------------------------------------
const BLUE_IN_PROGRESS = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
const GREEN_COMPLETED = 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
const PURPLE_BILLED = 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'

const PM_STATUS_META: Record<TicketStatus, StatusMeta> = {
  unassigned: {
    label: 'Unassigned',
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  },
  assigned: {
    label: 'Assigned',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  // Was orange — unified to BLUE_IN_PROGRESS per dimension 13/18. Note this
  // now renders the same blue as "Assigned" on the PM board; flagged in the
  // round-3 report rather than recolored unprompted.
  in_progress: { label: 'In Progress', classes: BLUE_IN_PROGRESS },
  completed: { label: 'Completed', classes: GREEN_COMPLETED },
  billed: { label: 'Billed', classes: PURPLE_BILLED },
  skip_requested: {
    label: 'Skip Requested',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  skipped: {
    label: 'Skipped',
    classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  },
}

const SERVICE_STATUS_META: Record<ServiceTicketStatus, StatusMeta> = {
  open: {
    label: 'Open',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  // Canonical label per PLAN Round 4 glossary — "Estimated" is retired as a
  // user-facing word (kept only as the internal enum key).
  estimated: {
    label: 'Awaiting Approval',
    classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  },
  in_progress: { label: 'In Progress', classes: BLUE_IN_PROGRESS },
  // Was emerald — unified to GREEN_COMPLETED per dimension 13/18.
  completed: { label: 'Completed', classes: GREEN_COMPLETED },
  // Was indigo — unified to PURPLE_BILLED per dimension 13/18.
  billed: { label: 'Billed', classes: PURPLE_BILLED },
  declined: {
    label: 'Declined',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  canceled: {
    label: 'Canceled',
    classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  },
}

// Canonical parts vocabulary per PLAN Round 4 glossary item 2 ("one label set
// across PmPartsSection, Parts Queue tabs, My Parts tabs"). Note this DIFFERS
// from the tech-facing wording PartsStatusBadge used to show on its own
// ("Ready for Pickup", "Awaiting Order", "On Order") — see the round-3 report,
// flagged as a wording change worth a second look, not just a rename.
const PARTS_STATUS_META: Record<PartsStatusKey, StatusMeta> = {
  pending_review: {
    label: 'In Review',
    classes: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  },
  requested: {
    label: 'Requested',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  ordered: {
    label: 'Ordered',
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  received: {
    label: 'Received',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  from_stock: {
    label: 'From Stock',
    classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  },
  // Not wired to any caller yet (see PartsStatusKey doc comment).
  pulled: {
    label: 'Pulled',
    classes: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  },
  // Terminal state stamped alongside cancelled:true. Part rows render the
  // cancelled treatment off the `cancelled` flag (a struck-through line +
  // "Cancelled"), so this badge meta is a fallback for completeness.
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
}

// Matches MySuppliesClient's existing local STATUS_BADGE exactly (dominant
// convention already in prod) — no color change, just a shared home.
const SUPPLY_STATUS_META: Record<SupplyRequestStatus, StatusMeta> = {
  pending: {
    label: 'Pending',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  ready: {
    label: 'Ready for pickup',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  picked_up: {
    label: 'Picked up',
    classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  },
  denied: {
    label: 'Denied',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
}

// Dashboard "Tech Leads" pipeline convention (literal DB-value reading —
// pending = still awaiting office review = "Submitted"; approved = office
// signed off = "Approved"). This is INTENTIONALLY different from the
// tech-payouts hub's own local STATUS_LABEL (TechPayoutsClient.tsx), which
// relabels 'approved' as "pending" for payout-hub context — reconciling the
// two vocabularies is scoped to the Round 4 terminology sweep, not here.
const LEAD_STATUS_META: Record<TechLeadStatus, StatusMeta> = {
  pending: {
    label: 'Submitted',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  match_pending: {
    label: 'Match Pending',
    classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  earned: {
    label: 'Earned',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  paid: {
    label: 'Paid',
    classes: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  },
  expired: {
    label: 'Expired',
    classes: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-300',
  },
}

// No existing UI badge consumes this yet — added because the round-3 spec
// named 'ace' as a domain to cover. 'paid' intentionally reuses lead.paid's
// emerald (same real-world concept: money disbursed to the tech).
const ACE_STATUS_META: Record<AceLaborStatus, StatusMeta> = {
  pending: {
    label: 'Pending',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  approved: {
    label: 'Approved',
    classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  rejected: {
    label: 'Rejected',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  paid: {
    label: 'Paid',
    classes: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200',
  },
}

// Per-ORDER credit review state (distinct from creditHold, the customer-level
// flag). Labels already matched the Round 4 canonical pair ("Pending Credit
// Review" / "Blocked (Credit)") — no wording change here.
const CREDIT_REVIEW_STATUS_META: Record<CreditReviewStatus, StatusMeta> = {
  pending: {
    label: 'Pending Credit Review',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  blocked: {
    label: 'Blocked (Credit)',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  released: {
    label: 'Credit Released',
    classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
}

const CREDIT_HOLD_STATUS_META: Record<CreditHoldStatusKey, StatusMeta> = {
  active: {
    label: 'Credit Hold',
    classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
}

// Inside/outside is left bare ("Inside" / "Outside") — the glossary's
// "Inside (Shop) / Outside (Field)" qualifier is a Round 4 page-copy decision,
// not asked for in this round's badge spec. Not changed here.
const TICKET_TYPE_META: Record<ServiceTicketType, StatusMeta> = {
  inside: {
    label: 'Inside',
    classes: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  outside: {
    label: 'Outside',
    classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  },
}

export const STATUS_META = {
  pm: PM_STATUS_META,
  service: SERVICE_STATUS_META,
  parts: PARTS_STATUS_META,
  supply: SUPPLY_STATUS_META,
  lead: LEAD_STATUS_META,
  ace: ACE_STATUS_META,
  creditReview: CREDIT_REVIEW_STATUS_META,
  creditHold: CREDIT_HOLD_STATUS_META,
  ticketType: TICKET_TYPE_META,
} as const

export type StatusDomain = keyof typeof STATUS_META
export type StatusOf<D extends StatusDomain> = keyof (typeof STATUS_META)[D]

const FALLBACK_META: StatusMeta = {
  label: 'Unknown',
  classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}

/** Look up the canonical { label, classes } for a (domain, status) pair. */
export function getStatusMeta<D extends StatusDomain>(domain: D, status: StatusOf<D>): StatusMeta {
  const map = STATUS_META[domain] as Record<string, StatusMeta>
  return map[status as string] ?? FALLBACK_META
}
