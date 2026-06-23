import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { findStrandedTickets, repointTicketBillTo } from '@/lib/db/repoint-billto'

// POST /api/equipment/[id]/propagate-billto
//
// After an equipment's bill-to account is reassigned, repoint the still-open
// tickets on that equipment that are stranded on the old account. Manager-only.
//
// The eligible set is re-derived server-side from the equipment's CURRENT
// customer (the post-reassignment account) via findStrandedTickets, so a stale
// modal can't repoint tickets that are no longer eligible, and the per-ticket
// safe-repoint guards (Synergy-keyed hard block, active-account check,
// equipment-link consistency) all still apply. No client-supplied ticket ids are
// trusted.
//
// Optional body `{ expected_customer_id }` asserts the modal's view of the
// target account still matches the equipment's current account (guards against a
// second reassignment happening between open and confirm).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Only managers can propagate a bill-to change.' },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      expected_customer_id?: unknown
    }

    const supabase = await createClient()

    // Target account = the equipment's CURRENT (already-reassigned) customer.
    const { data: equip, error: equipErr } = await supabase
      .from('equipment')
      .select('customer_id')
      .eq('id', id)
      .maybeSingle()
    if (equipErr || !equip) {
      return NextResponse.json({ error: 'Equipment not found.' }, { status: 404 })
    }
    const targetCustomerId = equip.customer_id
    if (targetCustomerId == null) {
      return NextResponse.json(
        { error: 'Equipment has no bill-to account.' },
        { status: 422 }
      )
    }

    // Guard against a stale modal: the target must still be what the client saw.
    if (
      body.expected_customer_id !== undefined &&
      Number(body.expected_customer_id) !== targetCustomerId
    ) {
      return NextResponse.json(
        { error: 'The equipment bill-to changed again — reopen the equipment and try again.' },
        { status: 409 }
      )
    }

    const { serviceTickets, pmTickets } = await findStrandedTickets(supabase, {
      equipmentId: id,
      targetCustomerId,
    })

    let updated = 0
    const skipped: Array<{ id: string; kind: 'service' | 'pm'; error: string }> = []

    for (const t of serviceTickets) {
      const result = await repointTicketBillTo(supabase, {
        kind: 'service',
        ticketId: t.id,
        customerId: targetCustomerId,
      })
      if (result.ok && result.changed) updated++
      else if (!result.ok) skipped.push({ id: t.id, kind: 'service', error: result.error })
    }
    for (const t of pmTickets) {
      const result = await repointTicketBillTo(supabase, {
        kind: 'pm',
        ticketId: t.id,
        customerId: targetCustomerId,
      })
      if (result.ok && result.changed) updated++
      else if (!result.ok) skipped.push({ id: t.id, kind: 'pm', error: result.error })
    }

    return NextResponse.json({ success: true, updated, skipped })
  } catch (err) {
    console.error('equipment/[id]/propagate-billto POST error:', err)
    return NextResponse.json({ error: 'Failed to propagate bill-to change' }, { status: 500 })
  }
}
