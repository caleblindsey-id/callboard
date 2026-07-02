import 'server-only'
import { cookies } from 'next/headers'

// Durable device identity for quick-PIN login.
//
// Why a server-set httpOnly cookie instead of localStorage: the device_id binds a
// tech's PIN to a device (see device_pins). It used to live only in localStorage,
// but iOS Safari/PWA ITP evicts script-writable storage (localStorage AND
// document.cookie) after ~7 idle days. On field phones that silently wiped the id,
// so the server lookup missed and the tech was dropped to email/password. A cookie
// set via the HTTP Set-Cookie header with httpOnly is NOT script-writable, so it is
// exempt from that 7-day cap and persists up to the browser's 400-day ceiling.
//
// The value is an opaque random UUID, never a secret: the PIN hash + scrypt pepper +
// server-side lockout are what actually gate login. So the cookie is a stable handle,
// not a credential.

export const DEVICE_COOKIE = 'cb-did'

export const DEVICE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 34560000, // 400 days — the browser-enforced ceiling; re-set on every read so it slides forward
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Read the durable device id from the cookie, or '' if not set yet. */
export async function getDeviceCookie(): Promise<string> {
  const store = await cookies()
  return store.get(DEVICE_COOKIE)?.value ?? ''
}

/**
 * Resolve the canonical device id and (re)issue the cookie so its window slides
 * forward on every call.
 *
 * Precedence: existing cookie > a well-formed `adoptId` (one-time adoption of a
 * legacy localStorage id, so devices enrolled before this shipped keep their PIN) >
 * a freshly minted UUID. `adoptId` is only honored when no cookie exists yet, so a
 * caller can never overwrite an established device with an attacker-chosen value.
 */
export async function resolveDeviceId(adoptId?: string | null): Promise<string> {
  const store = await cookies()
  const existing = store.get(DEVICE_COOKIE)?.value
  let id: string
  if (existing && UUID_RE.test(existing)) {
    id = existing
  } else if (adoptId && UUID_RE.test(adoptId)) {
    id = adoptId
  } else {
    id = crypto.randomUUID()
  }
  store.set(DEVICE_COOKIE, id, DEVICE_COOKIE_OPTS)
  return id
}
