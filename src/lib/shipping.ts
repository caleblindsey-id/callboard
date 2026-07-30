// Inbound-freight charge and requested shipping method (feedback #80).
//
// Two separate concerns that both live here because they are two halves of the
// same conversation between the technician and the buyer:
//
//   shipping_method  — what the TECH asks for at request time ("customer wants
//                      it next day"), carried on the parts_requested JSONB.
//   shipping_charge  — what the OFFICE bills the customer, a flat-dollar column
//                      on the parent ticket (migration 148).
//
// One module rather than inline copies at each site because this codebase has
// been burned repeatedly by a hand-rolled second copy of a predicate drifting
// from the first — see the comment block on isPartOutstanding in ./parts.ts,
// where the same rule written twice made the board and the detail page disagree
// about the same ticket. Every route, PDF, and component reads the labels and
// the validator from here.

/** Shipping speeds a technician can request on a part. */
export const SHIPPING_METHODS = ['standard', 'second_day', 'next_day'] as const

export type ShippingMethod = (typeof SHIPPING_METHODS)[number]

/**
 * Customer-facing labels. 'next_day' is deliberately NOT called "NDA" (the
 * abbreviation Mike used in the report) — that is carrier shorthand the office
 * reads fluently and a customer on an estimate does not.
 */
const SHIPPING_METHOD_LABELS: Record<ShippingMethod, string> = {
  standard: 'Standard',
  second_day: '2nd Day Air',
  next_day: 'Next Day Air',
}

/** Compact labels for the Parts Queue badge, where row width is tight. */
const SHIPPING_METHOD_SHORT_LABELS: Record<ShippingMethod, string> = {
  standard: 'Standard',
  second_day: '2-Day',
  next_day: 'Next Day',
}

export const SHIPPING_NOTE_MAX_LEN = 500

/**
 * True for a real ShippingMethod. Used to narrow the untyped string that comes
 * off the JSONB / the queue view, both of which can carry anything a past
 * version of the app wrote.
 */
export function isShippingMethod(value: unknown): value is ShippingMethod {
  return typeof value === 'string' && (SHIPPING_METHODS as readonly string[]).includes(value)
}

/**
 * Method for a part request, defaulting to 'standard'.
 *
 * Absent means standard: every part requested before this feature shipped has
 * no shipping_method at all, and the branch was shipping those ground. Reading
 * the absence as 'standard' is what lets the field go in with no backfill.
 * An unrecognized value falls back the same way rather than throwing — a bad
 * string on one row must not break the whole queue render.
 */
export function shippingMethodOf(
  part: { shipping_method?: string | null } | null | undefined,
): ShippingMethod {
  const raw = part?.shipping_method
  return isShippingMethod(raw) ? raw : 'standard'
}

/** Display label for a method (defaults to Standard for absent/unknown). */
export function shippingMethodLabel(value: unknown): string {
  return SHIPPING_METHOD_LABELS[isShippingMethod(value) ? value : 'standard']
}

/** Compact label for tight layouts (queue badges, pick list). */
export function shippingMethodShortLabel(value: unknown): string {
  return SHIPPING_METHOD_SHORT_LABELS[isShippingMethod(value) ? value : 'standard']
}

/**
 * True when the request asks for something faster than ground.
 *
 * This is the whole point of surfacing the field: a priority request is only
 * worth anything if the buyer sees it BEFORE placing the PO. Drives the queue
 * badge and the pick-list callout. Standard/absent is deliberately not
 * highlighted — badging every row trains people to ignore the badge.
 */
export function isPriorityShipping(
  part: { shipping_method?: string | null } | null | undefined,
): boolean {
  return shippingMethodOf(part) !== 'standard'
}

/**
 * Validate and normalize a freight charge coming off the wire.
 *
 * Returns the number on success, `null` for an explicit clear (null / '' —
 * "no freight charged", which is distinct from an explicit 0), or an Error
 * message string when the value is unusable. Callers map that message straight
 * into a 400.
 *
 * Shared by the ticket PATCH routes and the parts-queue set_shipping_charge
 * action so the three write paths can't disagree about what counts as valid —
 * the DB CHECK (>= 0) is the backstop, not the first line of defence, and a
 * constraint violation surfaces as an opaque 500 rather than a usable message.
 */
export function normalizeShippingCharge(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null }
  }
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return { ok: false, error: 'Shipping charge must be a number.' }
  }
  if (n < 0) {
    return { ok: false, error: 'Shipping charge must be 0 or more.' }
  }
  // Round to cents so a stray 25.999 can't drift the stored total away from
  // every .toFixed(2) that displays it (same rule as billing_amount).
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/**
 * The freight amount to bill, as a plain number for the billing math.
 *
 * NULL (none charged) collapses to 0 so callers can add it unconditionally,
 * exactly like the trip-charge term it sits next to.
 */
export function shippingChargeAmount(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Trim + clamp a free-text shipping note, or undefined when empty. */
export function normalizeShippingNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, SHIPPING_NOTE_MAX_LEN)
}
