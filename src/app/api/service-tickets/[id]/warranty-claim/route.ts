import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { ServiceTicketUpdate } from '@/types/service-tickets'

// Records the vendor-credit lifecycle of a warranty claim from the warranty-claims
// worklist. A warranty/partial-warranty repair isn't billed until the vendor
// credit that offsets covered parts is received; this is how the office logs the
// claim being filed and the credit coming back. Manager/coordinator only — a
// front-desk/finance action, not a tech one. Mirrors resolve-decline.
//
// Body: { action: 'file' | 'credit' | 'edit' | 'reset', vendor?, claim_number?,
//         credit_expected?, credit_amount? }
//   file   — stamp the claim filed (submitted_at + who), set vendor/claim#/expected
//   credit — stamp the credit received (received_at + who + amount)
//   edit   — update vendor/claim#/expected/amount without moving the lifecycle clocks
//   reset  — clear the credit-received stamp (correct a mistaken entry)
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
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body?.action as string | undefined
    if (!['file', 'credit', 'edit', 'reset'].includes(action ?? '')) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    // Numeric guards — credit amounts must be finite, non-negative when present.
    const num = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const creditExpected = num(body?.credit_expected)
    const creditAmount = num(body?.credit_amount)
    if (Number.isNaN(creditExpected) || (typeof creditExpected === 'number' && creditExpected < 0)) {
      return NextResponse.json({ error: 'credit_expected must be a non-negative number' }, { status: 400 })
    }
    if (Number.isNaN(creditAmount) || (typeof creditAmount === 'number' && creditAmount < 0)) {
      return NextResponse.json({ error: 'credit_amount must be a non-negative number' }, { status: 400 })
    }

    const supabase = await createClient()

    // Guard to a real warranty/partial-warranty ticket.
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('id, billing_type, deleted_at')
      .eq('id', id)
      .single()
    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    if (current.deleted_at) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }
    if (current.billing_type !== 'warranty' && current.billing_type !== 'partial_warranty') {
      return NextResponse.json({ error: 'This is not a warranty ticket.' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const trim = (v: unknown): string | null | undefined =>
      v === undefined ? undefined : (typeof v === 'string' && v.trim() ? v.trim() : null)

    const update: ServiceTicketUpdate = {}

    // Common editable details (apply on file/edit/credit when provided).
    const vendor = trim(body?.vendor)
    const claimNumber = trim(body?.claim_number)
    if (vendor !== undefined) update.warranty_vendor = vendor
    if (claimNumber !== undefined) update.warranty_claim_number = claimNumber
    if (creditExpected !== undefined) update.warranty_credit_expected = creditExpected
    if (creditAmount !== undefined) update.warranty_credit_amount = creditAmount

    if (action === 'file') {
      update.warranty_claim_submitted_at = now
      update.warranty_claim_submitted_by_id = user.id
    } else if (action === 'credit') {
      update.warranty_credit_received_at = now
      update.warranty_credit_received_by_id = user.id
      // Filing is implied when the credit comes back without a logged filing.
      // Stamp it so the lifecycle stays coherent.
      // (Done in a follow-up read-modify only if needed; cheap to always set
      // submitted_at when null is preferable but requires the current value.)
    } else if (action === 'reset') {
      update.warranty_credit_received_at = null
      update.warranty_credit_received_by_id = null
      update.warranty_credit_amount = null
    }

    if (action === 'credit') {
      // Ensure submitted_at is set so the claim doesn't read as "never filed"
      // after the credit lands (covers logging a credit on a claim filed offline).
      const { data: existing } = await supabase
        .from('service_tickets')
        .select('warranty_claim_submitted_at')
        .eq('id', id)
        .single()
      if (!existing?.warranty_claim_submitted_at) {
        update.warranty_claim_submitted_at = now
        update.warranty_claim_submitted_by_id = user.id
      }
    }

    const { error } = await supabase
      .from('service_tickets')
      .update(update)
      .eq('id', id)

    if (error) {
      console.error('warranty-claim: update failed', error)
      return NextResponse.json({ error: 'Failed to update the warranty claim' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('service-tickets/[id]/warranty-claim POST error:', err)
    return NextResponse.json({ error: 'Failed to update the warranty claim' }, { status: 500 })
  }
}
