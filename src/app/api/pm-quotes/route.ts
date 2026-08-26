import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { buildQuoteLines, type QuotableTicket } from '@/lib/pm-quotes/build'

// ============================================================
// POST /api/pm-quotes — build a draft quote from selected PM work orders.
//
// Always creates a record, even for a customer without pm_quote_required. The
// flag governs the automatic surfacing (badge, queue, start-work gate), not
// who may be quoted: one-off asks are how this feature started, and a quote
// that was handed to a customer should leave a trail either way.
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const ticketIds = body?.ticketIds

    if (
      !Array.isArray(ticketIds) ||
      ticketIds.length === 0 ||
      !ticketIds.every((t) => typeof t === 'string')
    ) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // A soft-deleted ticket must never price into a customer document; the
    // count check inside buildQuoteLines turns a filtered-out id into a hard
    // failure rather than a silently short quote.
    const { data: rawTickets, error: fetchError } = await supabase
      .from('pm_tickets')
      .select(`
        id,
        work_order_number,
        customer_id,
        equipment(make, model, serial_number, description),
        pm_schedules(billing_type, flat_rate, interval_months)
      `)
      .in('id', ticketIds as string[])
      .is('deleted_at', null)

    if (fetchError) {
      console.error('[pm-quotes] ticket fetch error:', fetchError)
      return NextResponse.json({ error: 'Failed to load the selected work orders' }, { status: 500 })
    }

    const built = buildQuoteLines(
      (rawTickets ?? []) as unknown as QuotableTicket[],
      ticketIds.length
    )
    if (!built.ok) {
      return NextResponse.json({ error: built.error }, { status: built.status })
    }

    const { data: quote, error: insertError } = await supabase
      .from('pm_quotes')
      .insert({
        customer_id: built.customerId,
        status: 'draft',
        subtotal: built.subtotal,
        created_by_id: dbUser.id,
      })
      .select('id, quote_number')
      .single()

    if (insertError || !quote) {
      console.error('[pm-quotes] insert error:', insertError)
      return NextResponse.json({ error: 'Failed to create the quote' }, { status: 500 })
    }

    const { error: linesError } = await supabase.from('pm_quote_lines').insert(
      built.lines.map((l) => ({ ...l, quote_id: quote.id }))
    )

    if (linesError) {
      console.error('[pm-quotes] line insert error:', linesError)
      // A quote with no lines is worse than no quote: it would show a $0 total
      // in the list and read as a real document. Roll the header back.
      await supabase.from('pm_quotes').delete().eq('id', quote.id)
      return NextResponse.json({ error: 'Failed to create the quote lines' }, { status: 500 })
    }

    return NextResponse.json({ id: quote.id, quote_number: quote.quote_number }, { status: 201 })
  } catch (err) {
    console.error('[pm-quotes] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
