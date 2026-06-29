import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveDeviceId } from '@/lib/pin-device-cookie'

// Device endpoint for quick-PIN. Serves two callers off the SAME durable device
// cookie (cb-did), so the source of truth is the server's device_pins rows, not the
// browser's (ITP-evictable) localStorage:
//
//   * Login page (UNauthenticated): "which PINs are enrolled on this device?" — used
//     to decide whether to show the PIN pad and to populate the "Who's this?" picker.
//   * Account page (authenticated): "does the current tech have a PIN on this device?"
//
// This route is in the proxy public-skip list so the login page can call it before a
// session exists. It resolves + (re)issues the device cookie on every call, optionally
// adopting a legacy localStorage id passed as ?adopt= (one-time, only when no cookie
// exists yet) so devices enrolled before this shipped keep their PIN.
//
// Generic by design: returns only first-name labels for THIS device's rows. The PIN
// hash, scrypt pepper, and lockout still gate any actual login.
export async function GET(request: NextRequest) {
  try {
    const adoptId = request.nextUrl.searchParams.get('adopt')
    const deviceId = await resolveDeviceId(adoptId)

    const admin = await createAdminClient('SERVER_ONLY')
    const { data: rows } = await admin
      .from('device_pins')
      .select('user_id, label')
      .eq('device_id', deviceId)

    // Fill in display names from users for any row missing a label (label is stamped
    // with the tech's name at enroll, but older rows may be null).
    const deviceRows = rows ?? []
    const missingNameIds = deviceRows.filter((r) => !r.label).map((r) => r.user_id)
    const nameById = new Map<string, string>()
    if (missingNameIds.length > 0) {
      const { data: users } = await admin
        .from('users')
        .select('id, name')
        .in('id', missingNameIds)
      for (const u of users ?? []) nameById.set(u.id, u.name ?? '')
    }

    const profiles = deviceRows.map((r) => ({
      userId: r.user_id,
      name: r.label || nameById.get(r.user_id) || 'this account',
    }))

    // If a session exists (account page), also report whether the current user is
    // enrolled on this device. The login page ignores this field.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const enrolledForCurrentUser = user ? profiles.some((p) => p.userId === user.id) : false

    return NextResponse.json({ device_id: deviceId, profiles, enrolledForCurrentUser })
  } catch (err) {
    console.error('GET /api/auth/pin/status error:', err)
    return NextResponse.json({ error: 'Could not check PIN status.' }, { status: 500 })
  }
}
