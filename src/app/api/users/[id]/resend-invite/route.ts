import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, ADMIN_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendUserInviteEmail } from '@/lib/users/send-invite-email'

// Re-send the set-password invite email to an existing user. The original temp
// password is never stored, so there is nothing to "look up" — sendUserInviteEmail
// mints a fresh single-use recovery link each call. Manager-gated, mirrors the
// create-user route's role check.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const currentUser = await getCurrentUser()
    if (!currentUser?.role || !ADMIN_ROLES.includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params

    const admin = await createAdminClient('ADMIN_ONLY')
    const { data: user, error } = await admin
      .from('users')
      .select('email, name, active')
      .eq('id', id)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }
    if (!user.email) {
      return NextResponse.json({ error: 'This user has no email on file.' }, { status: 400 })
    }
    if (user.active === false) {
      return NextResponse.json({ error: 'This user is deactivated.' }, { status: 400 })
    }

    await sendUserInviteEmail({ email: user.email, name: user.name })

    return NextResponse.json({ sent: true })
  } catch (err) {
    console.error('POST /api/users/[id]/resend-invite error:', err)
    return NextResponse.json({ error: 'Failed to send the invite email.' }, { status: 500 })
  }
}
