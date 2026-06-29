import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveDeviceId } from '@/lib/pin-device-cookie'

// Remove the calling tech's quick-PIN from a device ("Forget this device").
// Session-required; only ever deletes the authenticated user's own row.
export async function POST(request: NextRequest) {
  try {
    const { device_id: bodyDeviceId } = (await request.json().catch(() => ({}))) as { device_id?: string }
    // Cookie is canonical; body is a transitional fallback / adopt hint.
    const device_id = await resolveDeviceId(bodyDeviceId)
    if (!device_id) {
      return NextResponse.json({ error: 'Missing device id.' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.' }, { status: 401 })
    }

    const admin = await createAdminClient('SERVER_ONLY')
    const { error } = await admin
      .from('device_pins')
      .delete()
      .eq('device_id', device_id)
      .eq('user_id', user.id)
    if (error) {
      console.error('PIN forget delete failed:', error)
      return NextResponse.json({ error: 'Could not remove the PIN.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/auth/pin/forget error:', err)
    return NextResponse.json({ error: 'Could not remove the PIN.' }, { status: 500 })
  }
}
