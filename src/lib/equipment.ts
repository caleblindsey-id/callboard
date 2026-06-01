export function normalizeSerial(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

export function serialsMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeSerial(a)
  const nb = normalizeSerial(b)
  if (!na || !nb) return false
  return na.toLowerCase() === nb.toLowerCase()
}

/**
 * The minimal equipment shape the completion gate needs.
 */
export interface EquipmentVerifyState {
  make: string | null
  model: string | null
  details_verified_at: string | null
}

/**
 * Whether a technician must enter/verify this unit's identifying details before
 * a ticket against it can be completed.
 *
 * True when make or model is missing, or the unit has never been tech-verified.
 * Serial is intentionally NOT gated: a tech-verified blank serial is a deliberate
 * "no serial / not legible" — setting details_verified_at is the affirmation that
 * the blank was intentional, not an oversight. Verify-once: a stamped unit is
 * trusted on future completions.
 *
 * Pass null for tickets with no associated equipment — the gate doesn't apply.
 */
export function equipmentNeedsVerification(
  eq: EquipmentVerifyState | null | undefined
): boolean {
  if (!eq) return false
  return !eq.make?.trim() || !eq.model?.trim() || eq.details_verified_at == null
}
