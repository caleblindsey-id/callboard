import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { sendPickupNotice } from '@/lib/service-tickets/send-pickup-notice'
import { MandrillError } from '@/lib/mandrill'

// Manually email a "ready for pickup" notice for a staged unit. The billed/repaired
// flow sends this automatically; declined units stage SILENTLY, so the front desk
// fires the notice by hand from the pickup queue once any re-quote is exhausted.
// Also covers a billed unit whose instant send failed. Manager/coordinator only
// (a front-desk action) — not in the proxy.ts tech allowlist, so techs get a 403.
//
// sendPickupNotice picks the right copy (repaired vs declined) off the ticket's
// status and self-guards to units still awaiting pickup, so a stale tab can't
// notify an already-collected unit.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await sendPickupNotice(id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof MandrillError) {
      console.error('send-pickup-notice: mandrill send failed', err)
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('service-tickets/[id]/send-pickup-notice POST error:', err)
    return NextResponse.json({ error: 'Failed to send pickup notice' }, { status: 500 })
  }
}
