import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

// Set-password endpoint for the invite flow. UNauthenticated — the invited user
// has no session yet. The single-use recovery token (token_hash) proves who they
// are. Mirrors pin/login (server-side verifyOtp that lands Set-Cookie on the
// response) + change-password (clears the must_change_password flag).
//
// The token is consumed HERE, on POST with a password — never on a GET of the
// /set-password page — so an email link-scanner pre-fetch can't burn it. The
// proxy skips this route (see proxy.ts public-skip list) so it is reachable
// without a session.
export async function POST(request: NextRequest) {
  try {
    const { token_hash, password } = (await request.json()) as {
      token_hash?: string
      password?: string
    }

    if (!token_hash) {
      return NextResponse.json(
        { error: 'This link is invalid. Ask your administrator to resend your invite.' },
        { status: 400 },
      )
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    // Verify the recovery token on the SSR server client so the session cookies
    // land on the response. A bad/expired/already-used token fails here.
    const supabase = await createClient()
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash,
      type: 'recovery',
    })
    if (verifyError || !verifyData?.user) {
      return NextResponse.json(
        { error: 'This link has expired or already been used. Ask your administrator to resend your invite.' },
        { status: 400 },
      )
    }

    // Set the chosen password on the now-authenticated session.
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    const userId = verifyData.user.id

    // Clear the forced-change proxy cookie + DB flag (the account was created
    // with must_change_password=true as a break-glass fallback). Without this the
    // user would be redirect-looped to /change-password after setting a password.
    const cookieStore = await cookies()
    cookieStore.set('pm-must-change-pw', 'false', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 300,
    })

    const admin = await createAdminClient('SERVER_ONLY')
    const { error: dbError } = await admin
      .from('users')
      .update({ must_change_password: false })
      .eq('id', userId)

    if (dbError) {
      console.error('set-password: failed to clear must_change_password:', dbError)
      return NextResponse.json(
        { error: 'Password set, but a flag could not be cleared. Please contact an administrator.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/auth/set-password error:', err)
    return NextResponse.json({ error: 'Failed to set password.' }, { status: 500 })
  }
}
