import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { validateManualMatch, type ManualMatchInput } from '@/lib/tech-leads/validate-manual-match'

// POST /api/tech-leads/[id]/manual-match
//
// Lets a manager attach a known Synergy sale order to an approved equipment-sale
// lead and earn it on demand, instead of waiting for the nightly scan to detect
// the candidate (feedback #74 — e.g. the sale predates the lead's submit date, or
// the account was just corrected and the manager doesn't want to wait a day).
//
// Candidates are normally inserted only by the service-role scan (no INSERT RLS),
// so we insert with the admin client, then reuse the existing atomic
// confirm_match_candidate RPC (migration 047) to dismiss siblings + earn the lead
// in one transaction. No new migration needed.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const validated = validateManualMatch((await request.json()) as ManualMatchInput)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }
    const f = validated.fields

    const supabase = await createClient()
    const { data: lead, error: fetchErr } = await supabase
      .from('tech_leads')
      .select('id, lead_type, status')
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }
    if (lead.lead_type !== 'equipment_sale') {
      return NextResponse.json({ error: 'Only equipment-sale leads can be matched.' }, { status: 400 })
    }
    if (lead.status !== 'approved' && lead.status !== 'match_pending') {
      return NextResponse.json(
        { error: 'This lead is not awaiting a match.' },
        { status: 409 }
      )
    }

    // Ensure a pending candidate row exists for this order, then confirm it.
    const admin = await createAdminClient('SERVER_ONLY')
    let candidateId: string
    const { data: inserted, error: insErr } = await admin
      .from('equipment_sale_lead_candidates')
      .insert({
        tech_lead_id: id,
        synergy_order_number: f.synergy_order_number,
        synergy_order_date: f.synergy_order_date,
        synergy_order_total: f.synergy_order_total,
        order_lines: [],
        status: 'pending',
      })
      .select('id')
      .single()

    if (insErr) {
      // 23505 = unique (tech_lead_id, synergy_order_number) — the scan already
      // detected this order. Reuse the row (unless it's already confirmed).
      if ((insErr as { code?: string }).code !== '23505') {
        console.error('manual-match insert error:', insErr)
        return NextResponse.json({ error: 'Failed to record the match.' }, { status: 500 })
      }
      const { data: existing, error: exErr } = await admin
        .from('equipment_sale_lead_candidates')
        .select('id, status')
        .eq('tech_lead_id', id)
        .eq('synergy_order_number', f.synergy_order_number)
        .single()
      if (exErr || !existing) {
        console.error('manual-match lookup error:', exErr)
        return NextResponse.json({ error: 'Failed to record the match.' }, { status: 500 })
      }
      if (existing.status === 'confirmed') {
        return NextResponse.json(
          { error: 'This Synergy order is already matched to this lead.' },
          { status: 409 }
        )
      }
      candidateId = existing.id
      // Reset a previously-dismissed (or stale pending) row to pending so the
      // confirm CAS can pick it up, refreshing the order date/total.
      const { error: resetErr } = await admin
        .from('equipment_sale_lead_candidates')
        .update({
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
          synergy_order_date: f.synergy_order_date,
          synergy_order_total: f.synergy_order_total,
        })
        .eq('id', candidateId)
      if (resetErr) {
        console.error('manual-match reset error:', resetErr)
        return NextResponse.json({ error: 'Failed to record the match.' }, { status: 500 })
      }
    } else {
      candidateId = inserted.id
    }

    // Atomic confirm + earn (migration 047). Mirrors the candidates/confirm route.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('confirm_match_candidate', {
      p_lead_id: id,
      p_candidate_id: candidateId,
      p_tier: f.tier,
      p_bonus_amount: f.bonus_amount,
      p_user_id: user.id,
    })
    if (error) {
      const code = (error as { code?: string }).code
      if (code === 'P0001') {
        return NextResponse.json(
          { error: error.message || 'Lead is no longer in a matchable state.' },
          { status: 409 }
        )
      }
      console.error('manual-match confirm RPC error:', error)
      return NextResponse.json({ error: 'Failed to confirm the match.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, bonus_amount: f.bonus_amount, result: data })
  } catch (err) {
    console.error('manual-match POST error:', err)
    return NextResponse.json({ error: 'Failed to confirm the match.' }, { status: 500 })
  }
}
