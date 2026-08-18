import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ============================================================
// POST /api/quote-approve/[token] — public, no session.
//
// The customer-side counterpart to PATCH /api/pm-quotes/[id]. Runs through the
// service-role admin client because there is no logged-in user, so every guard
// here has to be explicit: the token must resolve, be unexpired, and the quote
// must still be in 'sent'.
//
// Accepting writes the PO number onto the quoted PM tickets. That is the point
// of the feature for PO-required accounts, where work used to get done and then
// stall in billing waiting on a purchase order.
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await request.json()
    const action = body?.action

    if (action !== 'accept' && action !== 'decline') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const supabase = await createAdminClient('SERVER_ONLY')

    const { data: quote } = await supabase
      .from('pm_quotes')
      .select(`
        id, status, approval_token_expires_at, deleted_at,
        customers!inner ( po_required ),
        pm_quote_lines ( pm_ticket_id )
      `)
      .eq('approval_token', token)
      .single()

    if (!quote || quote.deleted_at) {
      return NextResponse.json({ error: 'This link is no longer valid.' }, { status: 404 })
    }

    if (quote.approval_token_expires_at && new Date(quote.approval_token_expires_at) < new Date()) {
      return NextResponse.json({ error: 'This link has expired.' }, { status: 410 })
    }

    if (quote.status !== 'sent') {
      return NextResponse.json(
        { error: 'This quote has already been responded to.' },
        { status: 409 }
      )
    }

    if (action === 'decline') {
      const { error } = await supabase
        .from('pm_quotes')
        .update({
          status: 'declined',
          declined_at: new Date().toISOString(),
          decline_reason: typeof body.decline_reason === 'string' ? body.decline_reason : null,
        })
        .eq('id', quote.id)
        .eq('status', 'sent')

      if (error) {
        console.error('[quote-approve] decline error:', error)
        return NextResponse.json({ error: 'Could not record your response.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, status: 'declined' })
    }

    // --- accept ---
    const signature = typeof body.signature === 'string' ? body.signature : null
    const signatureName = typeof body.signature_name === 'string' ? body.signature_name.trim() : ''
    const poNumber = typeof body.po_number === 'string' ? body.po_number.trim() : ''

    if (!signature || !signatureName) {
      return NextResponse.json(
        { error: 'A signature and name are required to accept.' },
        { status: 400 }
      )
    }

    const customer = quote.customers as unknown as { po_required: boolean | null } | null
    if (customer?.po_required && !poNumber) {
      return NextResponse.json(
        { error: 'A PO number is required on your account. Please enter one to accept this quote.' },
        { status: 400 }
      )
    }

    // Compare-and-swap on 'sent' so a double submit cannot accept twice.
    const { data: accepted, error: acceptError } = await supabase
      .from('pm_quotes')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        signature,
        signature_name: signatureName,
        po_number: poNumber || null,
      })
      .eq('id', quote.id)
      .eq('status', 'sent')
      .select('id')
      .single()

    if (acceptError || !accepted) {
      console.error('[quote-approve] accept error:', acceptError)
      return NextResponse.json({ error: 'Could not record your response.' }, { status: 500 })
    }

    // Push the PO onto the quoted work orders. Deliberately only where none is
    // already set: a blanket PO from the equipment profile, or one the office
    // keyed by hand, is more specific than this and must not be clobbered.
    if (poNumber) {
      const ticketIds = ((quote.pm_quote_lines ?? []) as unknown as Array<{ pm_ticket_id: string }>)
        .map((l) => l.pm_ticket_id)
        .filter(Boolean)

      if (ticketIds.length > 0) {
        const { error: poError } = await supabase
          .from('pm_tickets')
          .update({ po_number: poNumber })
          .in('id', ticketIds)
          .is('po_number', null)
          .is('deleted_at', null)

        // Non-fatal: the acceptance itself is recorded and the PO is on the
        // quote, so the office can still key it. Log loudly rather than
        // failing a customer-facing action after the decisive write landed.
        if (poError) {
          console.error('[quote-approve] PO write-back failed for quote', quote.id, poError)
        }
      }
    }

    return NextResponse.json({ ok: true, status: 'accepted' })
  } catch (err) {
    console.error('[quote-approve] Unexpected error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
