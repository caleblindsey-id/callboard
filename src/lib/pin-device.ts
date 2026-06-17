// Client-side device identity + remembered-profile list for quick-PIN login.
// Lives in the browser's localStorage only — NO secrets here. The device_id is a
// random opaque id that binds a PIN to this device (the PIN is useless from any
// other device). The profile list is just {userId, name} so the login screen can
// show "Who's this?" on a shared device. The PIN itself is never stored client-side.

const DEVICE_ID_KEY = 'cb-device-id'
const PROFILES_KEY = 'cb-pin-profiles'

export type PinProfile = {
  userId: string
  name: string
}

/** Stable random id for this device, created on first use. '' during SSR. */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/** Profiles that have enrolled a PIN on this device. */
export function getProfiles(): PinProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p) => p && typeof p.userId === 'string' && typeof p.name === 'string')
  } catch {
    return []
  }
}

/** Add or update a profile (keyed by userId), most-recent-first. */
export function rememberProfile(profile: PinProfile): void {
  if (typeof window === 'undefined') return
  const others = getProfiles().filter((p) => p.userId !== profile.userId)
  const next = [profile, ...others]
  localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
}

/** Drop a profile from this device's picker (used by "Forget this device"). */
export function forgetProfile(userId: string): void {
  if (typeof window === 'undefined') return
  const next = getProfiles().filter((p) => p.userId !== userId)
  localStorage.setItem(PROFILES_KEY, JSON.stringify(next))
}

const ENROLL_DISMISS_KEY = 'cb-pin-enroll-dismissed'

/** Has this user tapped "Not now" on the PIN-enrollment prompt on this device? */
export function isEnrollDismissed(userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(ENROLL_DISMISS_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.includes(userId)
  } catch {
    return false
  }
}

/** Remember that this user declined PIN enrollment on this device. */
export function dismissEnroll(userId: string): void {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(ENROLL_DISMISS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const ids: string[] = Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === 'string')
      : []
    if (!ids.includes(userId)) ids.push(userId)
    localStorage.setItem(ENROLL_DISMISS_KEY, JSON.stringify(ids))
  } catch {
    /* private mode — fine, it just won't persist */
  }
}
