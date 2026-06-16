// Pure quick-PIN policy + lockout logic. No secrets, no crypto, no server-only —
// kept separate from pin.ts (which holds the server-only hashing) so this is unit
// testable under `node --test`.

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6

/**
 * Reject PINs that are the right length but trivially guessable. Returns a
 * human-readable reason (for enrollment) or null when the PIN is acceptable.
 */
export function pinPolicyError(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'PIN must be digits only.'
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return `PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`
  }
  // All same digit: 0000, 111111
  if (/^(\d)\1+$/.test(pin)) return 'Choose a less predictable PIN.'
  // Strict ascending or descending runs: 1234, 4321, 012345, 987654
  if (isSequential(pin)) return 'Choose a less predictable PIN.'
  return null
}

function isSequential(pin: string): boolean {
  let asc = true
  let desc = true
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1)
    if (diff !== 1) asc = false
    if (diff !== -1) desc = false
  }
  return asc || desc
}

// --- Lockout policy ---------------------------------------------------------
// Server-side brute-force defense. Below the threshold, failures just accumulate.
// At/after the threshold each additional failure locks the device row for an
// escalating window, capped, so a real tech who fat-fingers a couple times isn't
// punished but an attacker is throttled to a handful of guesses per window.

export const PIN_LOCK_THRESHOLD = 5
const BASE_LOCK_MS = 15 * 60 * 1000 // 15 minutes
const MAX_LOCK_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Lock duration after `attempts` consecutive failures, or 0 if below threshold. */
export function lockDurationMs(attempts: number): number {
  if (attempts < PIN_LOCK_THRESHOLD) return 0
  const over = attempts - PIN_LOCK_THRESHOLD
  return Math.min(BASE_LOCK_MS * Math.pow(2, over), MAX_LOCK_MS)
}
