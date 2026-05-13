import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const { password, current_password } = await request.json() as {
      password: string
      current_password?: string
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Session expired. Please log in again.' }, { status: 401 })
    }

    // Voluntary password changes must prove the current password. Forced
    // changes (must_change cookie set by the temp-password flow) skip this —
    // the user often doesn't know the temp password they were emailed.
    const cookieStore = await cookies()
    const mustChange = cookieStore.get('pm-must-change-pw')?.value === 'true'
    if (!mustChange) {
      if (!current_password || typeof current_password !== 'string') {
        return NextResponse.json(
          { error: 'Current password is required.' },
          { status: 400 }
        )
      }
      if (!user.email) {
        return NextResponse.json({ error: 'Account has no email on file.' }, { status: 400 })
      }
      // signInWithPassword validates the credential. On a match it also
      // refreshes the session cookies, which is fine.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current_password,
      })
      if (verifyErr) {
        return NextResponse.json(
          { error: 'Current password is incorrect.' },
          { status: 400 }
        )
      }
    }

    // Update password via the user's own session (validates they're actually logged in)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    // Clear the must_change_password flag using admin client (bypasses RLS).
    // Always clear the proxy cookie even if the DB write fails — otherwise the
    // user would be redirect-looped back to /change-password but Supabase rejects
    // re-using the same password ("must be different from old password").
    cookieStore.set('pm-must-change-pw', 'false', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 300,
    })

    const admin = createAdminClient()
    const { error: dbError } = await admin
      .from('users')
      .update({ must_change_password: false })
      .eq('id', user.id)

    if (dbError) {
      console.error('Failed to clear must_change_password:', dbError)
      return NextResponse.json(
        { error: 'Password updated but the change-required flag could not be cleared. Please contact an administrator.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/auth/change-password error:', err)
    return NextResponse.json({ error: 'Failed to change password.' }, { status: 500 })
  }
}
