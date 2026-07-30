import type { LaborRateType } from '@/types/database'

/**
 * The labor rate types billing understands, mirroring the DB CHECK constraint
 * on `service_tickets.labor_rate_type` / `pm_tickets.labor_rate_type` and the
 * three rate columns resolved by `getCustomerLaborRate`.
 *
 * Shared rather than re-declared per route: an unrecognised type does NOT throw
 * in `getCustomerLaborRate` — it silently falls back to the standard column —
 * so a typo'd value bills at the wrong rate with nothing in the logs. Validate
 * at the edge, once, against this list.
 */
export const LABOR_RATE_TYPES = ['standard', 'industrial', 'vacuum'] as const

export function isLaborRateType(v: unknown): v is LaborRateType {
  return typeof v === 'string' && (LABOR_RATE_TYPES as readonly string[]).includes(v)
}

/**
 * Pick the rate type to bill at: what the submitter chose, else what the ticket
 * already had, else standard. Anything unrecognised on either side degrades to
 * standard so it can never reach the rate lookup unvalidated.
 */
export function resolveLaborRateType(
  submitted: unknown,
  stored: unknown,
): LaborRateType {
  if (isLaborRateType(submitted)) return submitted
  if (isLaborRateType(stored)) return stored
  return 'standard'
}
