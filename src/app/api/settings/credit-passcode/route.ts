import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES, MANAGER_ROLES } from '@/lib/auth'
import { getSetting, setSetting } from '@/lib/db/settings'
import { hashPasscode } from '@/lib/credit-review-crypto'

const PASSCODE_KEY = 'credit_hold_release_passcode_hash'
const MIN_PASSCODE_LEN = 8
const MAX_PASSCODE_LEN = 200

// GET → { configured: boolean }. Managers may check whether a release passcode
// is set (so the settings UI can warn). The hash itself is NEVER returned.
export async function GET() {
  const user = await getCurrentUser()
  if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const hash = await getSetting(PASSCODE_KEY)
  return NextResponse.json({ configured: Boolean(hash && hash.length > 0) })
}

// PATCH → set/rotate the shared release passcode. Admin-only. The plaintext is
// hashed server-side (scrypt) and only the hash is stored.
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !ADMIN_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { passcode } = (await request.json()) as { passcode?: unknown }
    if (typeof passcode !== 'string' || passcode.trim().length < MIN_PASSCODE_LEN) {
      return NextResponse.json(
        { error: `Passcode must be at least ${MIN_PASSCODE_LEN} characters.` },
        { status: 400 }
      )
    }
    if (passcode.length > MAX_PASSCODE_LEN) {
      return NextResponse.json({ error: 'Passcode is too long.' }, { status: 400 })
    }

    const hash = await hashPasscode(passcode)
    await setSetting(PASSCODE_KEY, hash)
    return NextResponse.json({ configured: true })
  } catch (err) {
    console.error('credit-passcode PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update passcode.' }, { status: 500 })
  }
}
