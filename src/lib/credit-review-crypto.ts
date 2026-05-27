// Pure token + passcode primitives for the credit-review workflow. No DB, no
// network, no '@/' imports — kept separate so it's unit-testable under the
// node:test runner (which doesn't resolve path aliases).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32

export const CREDIT_REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

// 12-char base64url token — 72 bits of entropy, same shape as the estimate
// approval token.
export function mintToken(): string {
  return randomBytes(9).toString('base64url')
}

export function tokenExpiry(): string {
  return new Date(Date.now() + CREDIT_REVIEW_TOKEN_TTL_MS).toISOString()
}

// scrypt passcode hashing. Stored format: scrypt$N$r$p$saltB64$hashB64.
// Uses node:crypto (no new dependency); verify is constant-time.
export async function hashPasscode(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = scryptSync(plain.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPasscode(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltB64, 'base64')
    expected = Buffer.from(hashB64, 'base64')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  let derived: Buffer
  try {
    derived = scryptSync(plain.normalize('NFKC'), salt, expected.length, { N, r, p })
  } catch {
    return false
  }
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

// Split a comma/semicolon/whitespace-separated address list into trimmed,
// plausibly-valid addresses.
export function parseEmailList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@'))
}
