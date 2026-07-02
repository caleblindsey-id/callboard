import { createHash, timingSafeEqual } from 'node:crypto'

// Constant-time string comparison for shared-secret checks (cron bearers,
// sweep secrets). A plain `===` short-circuits on the first differing byte,
// which leaks how much of the guess was right through response timing.
//
// Both sides are SHA-256 hashed before comparing: timingSafeEqual throws on
// mismatched buffer lengths, and an early length check would leak the
// secret's length. Hashing fixes both lengths at 32 bytes.
export function timingSafeCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}
