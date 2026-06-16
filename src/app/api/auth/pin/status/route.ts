import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Whether the current tech has a quick-PIN enrolled on a given device. Backs the
// /account "this device" card so it shows Set vs Change/Remove correctly even if
// the browser's localStorage was cleared (the server row is the source of truth).
export async function GET(request: NextRequest) {
  try {
    const deviceId = request.nextUrl.searchParams.get('device_id')
    if (!deviceId) {
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
    const { count } = await admin
      .from('device_pins')
      .select('id', { count: 'exact', head: true })
      .eq('device_id', deviceId)
      .eq('user_id', user.id)

    return NextResponse.json({ enrolled: (count ?? 0) > 0 })
  } catch (err) {
    console.error('GET /api/auth/pin/status error:', err)
    return NextResponse.json({ error: 'Could not check PIN status.' }, { status: 500 })
  }
}
