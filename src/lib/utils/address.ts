// One-line address formatting for customer-facing documents.
//
// Synergy syncs an already-complete single-line string into
// `customers.billing_address` and `ship_to_locations.address` ("320 Branscomb
// Drive SW, JACKSONVILLE AL 362650000") while ALSO syncing city/state/zip into
// their own columns. Naively joining all four repeats the city, state, and zip
// on the page, which is what the PM quote printed on its first run. So the
// street line leads and each tail component is appended only when it is not
// already in it.
//
// Zips arrive as an unhyphenated 9-digit ZIP+4. A customer reading "362650000"
// sees a typo, so the +4 is dropped when it is all zeros and hyphenated
// otherwise, both inside the street string and in the standalone column.

/** "362650000" -> "36265"; "362651234" -> "36265-1234"; anything else unchanged. */
export function formatZip(zip: string | null | undefined): string | null {
  const raw = (zip ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 9) {
    const base = digits.slice(0, 5)
    const plus4 = digits.slice(5)
    return plus4 === '0000' ? base : `${base}-${plus4}`
  }
  return raw
}

/** Same +4 normalization, applied to zips embedded in a free-text line. */
export function normalizeEmbeddedZips(text: string): string {
  return text.replace(/\b(\d{5})(\d{4})\b/g, (_m, base: string, plus4: string) =>
    plus4 === '0000' ? base : `${base}-${plus4}`
  )
}

/**
 * Uppercase, alphanumeric-token form used for containment tests, padded with
 * spaces on both ends so a match is always on whole tokens. That is what stops
 * the state code "AL" from reading as already present inside "ALABASTER".
 */
function tokenized(value: string): string {
  return ` ${value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `
}

/**
 * Street line plus whichever of city / state / zip it does not already carry.
 * Returns null when there is nothing to print.
 */
export function formatOneLineAddress(
  street: string | null | undefined,
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined
): string | null {
  const base = normalizeEmbeddedZips((street ?? '').trim()).replace(/[\s,]+$/, '')
  const haystack = tokenized(base)
  const tail: string[] = []

  for (const part of [city?.trim(), state?.trim(), formatZip(zip)]) {
    if (!part) continue
    if (!haystack.includes(tokenized(part))) tail.push(part)
  }

  return [base, ...tail].filter(Boolean).join(', ') || null
}
