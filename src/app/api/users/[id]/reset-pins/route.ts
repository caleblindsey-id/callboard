import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Manager action: wipe ALL of a user's quick-PINs across every device. Used when a
// tech loses a phone — the next time they open the app on any device they must log
// in with their password again (and can re-enroll a fresh PIN).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentUser()
    if (!actor?.role || !RESET_ROLES.includes(actor.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const admin = await createAdminClient('SERVER_ONLY')
    const { error } = await admin.from('device_pins').delete().eq('user_id', id)
    if (error) {
      console.error('reset-pins delete failed:', error)
      return NextResponse.json({ error: 'Could not reset PIN access.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/users/[id]/reset-pins error:', err)
    return NextResponse.json({ error: 'Could not reset PIN access.' }, { status: 500 })
  }
}
