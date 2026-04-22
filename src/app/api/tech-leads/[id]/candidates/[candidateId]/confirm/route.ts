import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import type { EquipmentSaleTier } from '@/types/database'
import { EQUIPMENT_SALE_TIERS } from '@/lib/tech-leads/bonus-tiers'

type Body = {
  tier: EquipmentSaleTier
}

// POST /api/tech-leads/[id]/candidates/[candidateId]/confirm
//
// Atomically:
//   1. Confirm the candidate (status='confirmed', reviewed_by/at).
//   2. Dismiss all other pending candidates on this lead.
//   3. Earn the lead: status='earned', sale_equipment_tier, sale_synergy_order_number,
//      bonus_amount from lookup, earned_at=now(), approved/payout fields untouched.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; candidateId: string }> }
) {
  const { id, candidateId } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { tier } = (await request.json()) as Body
    if (!tier || !(tier in EQUIPMENT_SALE_TIERS)) {
      return NextResponse.json({ error: 'A valid tier is required.' }, { status: 400 })
    }
    const bonus = EQUIPMENT_SALE_TIERS[tier].amount

    const supabase = await createClient()

    // Pull the candidate + its lead together for validation.
    const { data: candidate, error: candErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .select('id, tech_lead_id, status, synergy_order_number')
      .eq('id', candidateId)
      .single()
    if (candErr || !candidate) {
      return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 })
    }
    if (candidate.tech_lead_id !== id) {
      return NextResponse.json({ error: 'Candidate does not belong to this lead.' }, { status: 400 })
    }
    if (candidate.status !== 'pending') {
      return NextResponse.json({ error: `Candidate already ${candidate.status}.` }, { status: 400 })
    }

    const { data: lead, error: leadErr } = await supabase
      .from('tech_leads')
      .select('id, status, lead_type')
      .eq('id', id)
      .single()
    if (leadErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }
    if (lead.lead_type !== 'equipment_sale') {
      return NextResponse.json({ error: 'Only equipment-sale leads earn via candidates.' }, { status: 400 })
    }
    if (lead.status !== 'approved' && lead.status !== 'match_pending') {
      return NextResponse.json(
        { error: `Cannot confirm a match on a lead in status '${lead.status}'.` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // 1. Confirm this candidate.
    const { error: confirmErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .update({ status: 'confirmed', reviewed_by: user.id, reviewed_at: now })
      .eq('id', candidateId)
    if (confirmErr) {
      console.error('confirm candidate error:', confirmErr)
      return NextResponse.json({ error: 'Failed to confirm candidate.' }, { status: 500 })
    }

    // 2. Dismiss sibling pending candidates on this lead.
    const { error: dismissErr } = await supabase
      .from('equipment_sale_lead_candidates')
      .update({ status: 'dismissed', reviewed_by: user.id, reviewed_at: now })
      .eq('tech_lead_id', id)
      .eq('status', 'pending')
      .neq('id', candidateId)
    if (dismissErr) {
      console.error('dismiss siblings error:', dismissErr)
      return NextResponse.json({ error: 'Failed to dismiss other candidates.' }, { status: 500 })
    }

    // 3. Earn the lead.
    const { error: earnErr } = await supabase
      .from('tech_leads')
      .update({
        status: 'earned',
        sale_equipment_tier: tier,
        sale_synergy_order_number: candidate.synergy_order_number,
        bonus_amount: bonus,
        earned_at: now,
      })
      .eq('id', id)
    if (earnErr) {
      console.error('earn lead error:', earnErr)
      return NextResponse.json({ error: 'Failed to earn lead.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, bonus_amount: bonus })
  } catch (err) {
    console.error('confirm POST error:', err)
    return NextResponse.json({ error: 'Failed to confirm match.' }, { status: 500 })
  }
}
