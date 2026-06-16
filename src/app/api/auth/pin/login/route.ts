import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyPin, lockDurationMs } from '@/lib/pin'

// Quick-PIN login. UNauthenticated — the whole point is the tech has no session
// yet. Verifies the PIN for a (device_id, user_id) row under the service-role key,
// enforces lockout, and on success mints a real Supabase session for that user
// (generateLink -> verifyOtp), which sets the normal session cookies on the
// response. The proxy skips this route (see proxy.ts public-skip list) so it is
// reachable without a session.
//
// Generic errors only: never reveal whether the device/user/PIN existed.
export async function POST(request: NextRequest) {
  try {
    const { device_id, user_id, pin } = (await request.json()) as {
      device_id?: string
      user_id?: string
      pin?: string
    }
    if (!device_id || !user_id || !pin) {
      return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 401 })
    }

    const admin = await createAdminClient('SERVER_ONLY')

    const { data: row } = await admin
      .from('device_pins')
      .select('id, pin_hash, failed_attempts, locked_until')
      .eq('device_id', device_id)
      .eq('user_id', user_id)
      .maybeSingle()

    // No enrolled PIN for this device/user. Generic response — don't disclose.
    if (!row) {
      return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 401 })
    }

    // Locked out?
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later or use your password.', lockedUntil: row.locked_until },
        { status: 429 }
      )
    }

    const ok = await verifyPin(pin, row.pin_hash)

    if (!ok) {
      const attempts = (row.failed_attempts ?? 0) + 1
      const lockMs = lockDurationMs(attempts)
      await admin
        .from('device_pins')
        .update({
          failed_attempts: attempts,
          locked_until: lockMs > 0 ? new Date(Date.now() + lockMs).toISOString() : null,
        })
        .eq('id', row.id)
      if (lockMs > 0) {
        return NextResponse.json(
          { error: 'Too many attempts. Try again later or use your password.', lockedUntil: new Date(Date.now() + lockMs).toISOString() },
          { status: 429 }
        )
      }
      return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 401 })
    }

    // PIN correct. Confirm the account is still active and grab the email for minting.
    const { data: userRow } = await admin
      .from('users')
      .select('email, active')
      .eq('id', user_id)
      .single()
    if (!userRow || !userRow.active || !userRow.email) {
      return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 401 })
    }

    // Reset lockout counters and stamp last use.
    await admin
      .from('device_pins')
      .update({ failed_attempts: 0, locked_until: null, last_used_at: new Date().toISOString() })
      .eq('id', row.id)

    // Mint a session: generate a single-use magic-link OTP for this user, then
    // verify it on the SSR server client so Set-Cookie lands on the response.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userRow.email,
    })
    if (linkError || !linkData?.properties?.email_otp) {
      console.error('PIN login generateLink failed:', linkError)
      return NextResponse.json({ error: 'Could not sign you in. Please use your password.' }, { status: 500 })
    }

    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: userRow.email,
      token: linkData.properties.email_otp,
      type: 'magiclink',
    })
    if (verifyError) {
      console.error('PIN login verifyOtp failed:', verifyError)
      return NextResponse.json({ error: 'Could not sign you in. Please use your password.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/auth/pin/login error:', err)
    return NextResponse.json({ error: 'Could not sign you in.' }, { status: 500 })
  }
}
