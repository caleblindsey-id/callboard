// Shared source of truth for PM skip-request reason categories.
//
// Used by the tech-facing skip form (SkipRequestForm), the manager review
// display + approval dialog (TicketActions / SkipDialog), and server-side
// validation in the ticket PATCH route. Keep these three in sync by importing
// from here — never re-declare the list elsewhere.

export type SkipReasonCategory =
  | 'customer_reschedule'
  | 'customer_not_ready'
  | 'equipment_down'
  | 'access_issue'
  | 'equipment_removed'
  | 'service_ended'
  | 'other'

interface SkipReasonDef {
  value: SkipReasonCategory
  label: string
  // 'reschedule' → tech recommends a next-PM month; 'stop' → the equipment is
  // gone / service is ending, so the manager is prompted to deactivate the
  // recurring schedule instead of picking a new month.
  group: 'reschedule' | 'stop'
}

export const SKIP_REASONS: readonly SkipReasonDef[] = [
  { value: 'customer_reschedule', label: 'Customer requested reschedule', group: 'reschedule' },
  { value: 'customer_not_ready', label: 'Customer not ready / busy today', group: 'reschedule' },
  { value: 'equipment_down', label: 'Equipment down / awaiting repair', group: 'reschedule' },
  { value: 'access_issue', label: "Couldn't access equipment / site", group: 'reschedule' },
  { value: 'equipment_removed', label: 'Equipment removed / no longer on site', group: 'stop' },
  { value: 'service_ended', label: 'Customer ending service / canceling PM', group: 'stop' },
  { value: 'other', label: 'Other', group: 'reschedule' },
] as const

const BY_VALUE = new Map(SKIP_REASONS.map((r) => [r.value, r]))

export function isSkipReasonCategory(value: unknown): value is SkipReasonCategory {
  return typeof value === 'string' && BY_VALUE.has(value as SkipReasonCategory)
}

/** Human-readable label, or the raw value if it's an unknown/legacy category. */
export function skipReasonLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return BY_VALUE.get(value as SkipReasonCategory)?.label ?? value
}

/** A "stop" reason means the equipment is gone / service is ending. */
export function isStopReason(value: string | null | undefined): boolean {
  return !!value && BY_VALUE.get(value as SkipReasonCategory)?.group === 'stop'
}
