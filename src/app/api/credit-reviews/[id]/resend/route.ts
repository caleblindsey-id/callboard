import { NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { resendCreditReview } from '@/lib/credit-review'

// Re-mint the token + re-send the AR email for a pending credit review. Covers
// expired links and the "ar_email was unset" backlog. Manager-only.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const result = await resendCreditReview({ reviewId: id, actorId: user.id })

    if (!result.ok) {
      switch (result.code) {
        case 'not_found':
          return NextResponse.json({ error: 'Credit review not found.' }, { status: 404 })
        case 'not_pending':
          return NextResponse.json(
            { error: 'Only pending reviews can be resent.' },
            { status: 409 }
          )
        case 'ar_email_unset':
          return NextResponse.json(
            { error: 'No AR email is configured. Set it in Settings first.' },
            { status: 409 }
          )
        case 'app_url_unset':
          return NextResponse.json(
            { error: 'Public app URL is not configured.' },
            { status: 500 }
          )
        case 'email_failed':
          return NextResponse.json(
            { error: 'The email failed to send. Try again shortly.' },
            { status: 502 }
          )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('credit-review resend error:', err)
    return NextResponse.json({ error: 'Failed to resend.' }, { status: 500 })
  }
}
