import 'server-only'
import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'crypto'

// Server-only quick-PIN hashing. The PIN is a low-entropy secret (4-6 digits), so
// its safety rests on server-side controls: a per-server pepper folded into the
// hash, scrypt's work factor, device binding (enforced by the caller), and the
// lockout policy in ./pin-policy. Never expose the hash, the cost params, or
// whether a given PIN/device existed to the client.

// Pure policy/lockout helpers live in a server-only-free module so they can be
// unit tested; re-exported here so callers have a single import surface.
export {
  pinPolicyError,
  lockDurationMs,
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_LOCK_THRESHOLD,
} from './pin-policy'

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) =>
      err ? reject(err) : resolve(derivedKey as Buffer)
    )
  })
}

// scrypt cost. N must be a power of two. 2^15 keeps verify well under ~100ms on
// server hardware while making offline guessing expensive if the pepper ever leaks.
const SCRYPT_N = 32768
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEYLEN = 32
const SALT_BYTES = 16
// 128 * N * r ≈ 32 MiB, which sits exactly on Node's default maxmem ceiling and
// throws. Give scrypt headroom.
const SCRYPT_MAXMEM = 64 * 1024 * 1024

// The pepper is a server secret appended to every PIN before hashing. It must be
// set in the deployment env (Vercel) and locally. Absent in dev it falls back to
// empty with a one-time warning — fine for local testing, NOT acceptable in prod.
let warnedNoPepper = false
function pepper(): string {
  const p = process.env.PIN_PEPPER
  if (!p) {
    if (!warnedNoPepper && process.env.NODE_ENV === 'production') {
      console.warn('[pin] PIN_PEPPER is not set — quick-PIN hashing is running without a pepper. Set PIN_PEPPER in the environment.')
      warnedNoPepper = true
    }
    return ''
  }
  return p
}

/** Hash a PIN into a self-describing scrypt string: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(pin + pepper(), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/** Constant-time verify of a PIN against a stored scrypt string. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false
    const N = parseInt(parts[1], 10)
    const r = parseInt(parts[2], 10)
    const p = parseInt(parts[3], 10)
    const salt = Buffer.from(parts[4], 'base64')
    const expected = Buffer.from(parts[5], 'base64')
    const derived = await scryptAsync(pin + pepper(), salt, expected.length, { N, r, p, maxmem: SCRYPT_MAXMEM })
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}
