import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeServiceTicket } from '@/lib/db/service-tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { getLaborRate } from '@/lib/db/settings'
import type { ServicePartUsed } from '@/types/service-tickets'
import type { TicketPhoto } from '@/types/database'

interface CompleteServiceTicketBody {
  completed_at: string
  hours_worked: number
  parts_used: ServicePartUsed[]
  completion_notes: string | null
  customer_signature: string | null
  customer_signature_name: string | null
  photos: TicketPhoto[]
  warranty_labor_covered?: boolean
  ace_labor?: { hours: number; reason: string } | null
}

function isNonNegativeNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as CompleteServiceTicketBody

    const { completed_at, hours_worked, parts_used, completion_notes, customer_signature, customer_signature_name, photos, ace_labor } = body

    if (ace_labor != null) {
      if (!isNonNegativeNumber(ace_labor.hours) || ace_labor.hours <= 0) {
        return NextResponse.json(
          { error: 'ACE labor hours must be greater than 0' },
          { status: 400 }
        )
      }
      if (typeof ace_labor.reason !== 'string' || !ace_labor.reason.trim()) {
        return NextResponse.json(
          { error: 'ACE labor reason is required' },
          { status: 400 }
        )
      }
    }

    if (!completed_at || hours_worked === undefined) {
      return NextResponse.json(
        { error: 'completed_at and hours_worked are required' },
        { status: 400 }
      )
    }

    if (!isNonNegativeNumber(hours_worked)) {
      return NextResponse.json(
        { error: 'hours_worked must be a non-negative number' },
        { status: 400 }
      )
    }

    // Validate parts_used: every line non-negative price + positive qty
    if (Array.isArray(parts_used)) {
      for (const p of parts_used) {
        const qty = Number(p.quantity)
        const price = Number(p.unit_price)
        if (!Number.isFinite(qty) || qty <= 0) {
          return NextResponse.json({ error: 'Each part must have a positive quantity' }, { status: 400 })
        }
        if (!Number.isFinite(price) || price < 0) {
          return NextResponse.json({ error: 'Each part unit_price must be non-negative' }, { status: 400 })
        }
      }
    }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data: current, error: fetchError } = await supabase
      .from('service_tickets')
      .select('status, assigned_technician_id, billing_type, ticket_type, diagnostic_charge, labor_rate_type')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Signature required only for outside (field) tickets
    if (current.ticket_type !== 'inside' && (!customer_signature || !customer_signature_name)) {
      return NextResponse.json(
        { error: 'Customer signature and printed name are required' },
        { status: 400 }
      )
    }

    if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (current.status !== 'in_progress') {
      return NextResponse.json(
        { error: `Ticket must be in_progress to complete (currently: ${current.status})` },
        { status: 409 }
      )
    }

    // Server-authoritative billing math (mirrors PM /complete in section 2).
    // billing_amount is no longer accepted from the client — it's recomputed
    // for all roles from authoritative inputs.
    const billingType = current.billing_type as string
    const finalParts: ServicePartUsed[] = parts_used ?? []
    const diagnosticCharge = Number(current.diagnostic_charge ?? 0) || 0

    let finalBillingAmount: number
    if (billingType === 'warranty') {
      finalBillingAmount = 0
    } else {
      const laborRate = await getLaborRate(current.labor_rate_type ?? 'standard')
      const laborTotal = hours_worked * laborRate

      const billablePartsTotal = billingType === 'partial_warranty'
        ? finalParts.filter(p => !p.warranty_covered).reduce(
            (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0
          )
        : finalParts.reduce(
            (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0
          )

      finalBillingAmount = laborTotal + billablePartsTotal + diagnosticCharge
    }
    // Round to cents to avoid stored vs. displayed drift.
    finalBillingAmount = Math.round(finalBillingAmount * 100) / 100

    const updated = await completeServiceTicket(id, {
      completed_at,
      hours_worked,
      parts_used: finalParts,
      completion_notes: completion_notes ?? null,
      billing_amount: finalBillingAmount,
      customer_signature: customer_signature ?? null,
      customer_signature_name: customer_signature_name ?? null,
      photos: photos ?? [],
      warranty_labor_covered: body.warranty_labor_covered,
    })

    // ACE labor — see PM /complete for the upsert pattern (audit-stable on
    // re-completion, blocks overwrite of approved/paid entries).
    if (ace_labor != null) {
      const { data: existing, error: existingErr } = await supabase
        .from('ace_labor_entries')
        .select('id, status')
        .eq('service_ticket_id', id)
        .maybeSingle()
      if (existingErr) {
        console.error(`[complete] ACE lookup failed for service ticket ${id}:`, existingErr)
      } else if (existing && (existing.status === 'approved' || existing.status === 'paid')) {
        return NextResponse.json(
          { error: 'ACE labor entry already approved/paid; cannot be changed here.' },
          { status: 409 }
        )
      } else if (existing) {
        const { error: updErr } = await supabase
          .from('ace_labor_entries')
          .update({
            hours: ace_labor.hours,
            reason: ace_labor.reason.trim(),
            labor_rate_type: (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum',
            status: 'pending',
            rejected_reason: null,
            approved_by_id: null,
            approved_at: null,
            rate_value_at_approval: null,
            submitted_at: new Date().toISOString(),
            updated_by_id: user.id,
          })
          .eq('id', existing.id)
        if (updErr) console.error(`[complete] ACE update failed for service ticket ${id}:`, updErr)
      } else {
        // tech_id must point at the assigned technician, not the user
        // submitting completion. See PM /complete for full rationale.
        const aceTechId = current.assigned_technician_id ?? user.id
        const { error: insErr } = await supabase
          .from('ace_labor_entries')
          .insert({
            service_ticket_id: id,
            tech_id: aceTechId,
            hours: ace_labor.hours,
            labor_rate_type: (current.labor_rate_type ?? 'standard') as 'standard' | 'industrial' | 'vacuum',
            reason: ace_labor.reason.trim(),
            status: 'pending',
            created_by_id: user.id,
          })
        if (insErr) console.error(`[complete] ACE insert failed for service ticket ${id}:`, insErr)
      }
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('service-tickets/[id]/complete error:', err)
    return NextResponse.json(
      { error: 'Failed to complete service ticket' },
      { status: 500 }
    )
  }
}
