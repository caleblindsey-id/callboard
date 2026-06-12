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

// True when two serials are exactly equal OR within a single character edit
// (one insertion, deletion, or substitution) after normalization. This is the
// "near-miss" signal: feedback #18 had two records for the same machine whose
// serials differed by one inserted digit (10061330001011 vs 100631330001011),
// which the exact serialsMatch / unique index both missed.
//
// Deliberately a SOFT signal — callers warn, they don't block — because a one
// character difference can also be two genuinely different units (sequential
// serials). Pair it with a same make+model gate at the call site for precision.
// Transpositions (Levenshtein distance 2) are intentionally NOT flagged.
export function serialsNearMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeSerial(a)?.toLowerCase()
  const nb = normalizeSerial(b)?.toLowerCase()
  if (!na || !nb) return false
  return editDistanceWithin1(na, nb)
}

// Bounded edit-distance check: returns true iff `a` and `b` are at most one
// insertion/deletion/substitution apart. O(n) — bails as soon as a second
// difference is needed, so no full DP matrix.
function editDistanceWithin1(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false

  if (la === lb) {
    // Same length → only a single substitution can keep them within 1.
    let diffs = 0
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diffs++
        if (diffs > 1) return false
      }
    }
    return true
  }

  // Lengths differ by exactly 1 → the longer must equal the shorter with one
  // character inserted. Walk both with a single allowed skip in the longer.
  const shorter = la < lb ? a : b
  const longer = la < lb ? b : a
  let i = 0
  let j = 0
  let skipped = false
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++
      j++
    } else {
      if (skipped) return false
      skipped = true
      j++ // skip one char in the longer string
    }
  }
  return true
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

/**
 * Whether a ticket's machine is identified enough to request/order parts.
 *
 * This is the single source of truth shared by the client part-request gate
 * (ServiceTicketDetail `machineComplete`) and the server machine gate
 * (api/service-tickets/[id] PATCH). Keep the two in lockstep.
 *
 * Two cases, mirroring how equipment lives on a service ticket:
 *  - Linked equipment row present → ready once it's tech-verified
 *    (make + model + details_verified_at). Serial is intentionally optional:
 *    a verified blank serial is a deliberate "no serial / not legible", so a
 *    no-serial unit that's been verified must NOT stay blocked from parts.
 *  - Inline-only (no linked row) → ready when the inline make/model/serial are
 *    all present. These are office-entered at intake; there's no equipment row
 *    or verify panel to stamp, so field presence is the only available signal.
 */
export function equipmentReadyForParts(args: {
  inlineMake: string | null | undefined
  inlineModel: string | null | undefined
  inlineSerial: string | null | undefined
  linked: EquipmentVerifyState | null | undefined
}): boolean {
  if (args.linked) {
    return !equipmentNeedsVerification(args.linked)
  }
  return (
    !!args.inlineMake?.trim() &&
    !!args.inlineModel?.trim() &&
    !!args.inlineSerial?.trim()
  )
}
