import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import type { TechLeadUpdate } from '@/types/database'

type Action =
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'link_customer'    // convert free-text customer → real customer_id
  | 'link_equipment'   // set equipment_id after manager creates equipment from lead

type UpdateBody = {
  action: Action
  reason?: string
  customer_id?: number
  equipment_id?: string
}

// POST /api/tech-leads/[id]/update — approve / reject / cancel / link_customer / link_equipment.
// Restricted to super_admin + manager (same roles that can mark bonuses paid).
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

    const body = (await request.json()) as UpdateBody
    const { action, reason, customer_id, equipment_id } = body

    const supabase = await createClient()
    const { data: lead, error: fetchErr } = await supabase
      .from('tech_leads')
      .select('id, status, customer_id, customer_name_text, equipment_id')
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }

    const now = new Date().toISOString()
    let update: TechLeadUpdate = {}

    switch (action) {
      case 'approve': {
        if (lead.status !== 'pending') {
          return NextResponse.json(
            { error: `Cannot approve a lead in status '${lead.status}'.` },
            { status: 400 }
          )
        }
        update = {
          status: 'approved',
          approved_by: user.id,
          approved_at: now,
        }
        break
      }
      case 'reject': {
        if (lead.status !== 'pending') {
          return NextResponse.json(
            { error: `Cannot reject a lead in status '${lead.status}'.` },
            { status: 400 }
          )
        }
        if (!reason?.trim()) {
          return NextResponse.json(
            { error: 'A reason is required to reject a lead.' },
            { status: 400 }
          )
        }
        update = {
          status: 'rejected',
          approved_by: user.id,
          approved_at: now,
          rejected_reason: reason.trim(),
        }
        break
      }
      case 'cancel': {
        if (lead.status !== 'approved' && lead.status !== 'match_pending') {
          return NextResponse.json(
            { error: `Cannot cancel a lead in status '${lead.status}'. Only approved-but-not-earned leads may be cancelled.` },
            { status: 400 }
          )
        }
        if (!reason?.trim()) {
          return NextResponse.json(
            { error: 'A reason is required to cancel a lead.' },
            { status: 400 }
          )
        }
        update = {
          status: 'cancelled',
          cancelled_reason: reason.trim(),
        }
        break
      }
      case 'link_customer': {
        if (typeof customer_id !== 'number' || customer_id <= 0) {
          return NextResponse.json({ error: 'customer_id is required.' }, { status: 400 })
        }
        if (lead.customer_id) {
          return NextResponse.json(
            { error: 'Lead already has a linked customer.' },
            { status: 400 }
          )
        }
        update = {
          customer_id,
          customer_name_text: null,
        }
        break
      }
      case 'link_equipment': {
        if (!equipment_id) {
          return NextResponse.json({ error: 'equipment_id is required.' }, { status: 400 })
        }
        if (lead.status !== 'approved') {
          return NextResponse.json(
            { error: `Cannot link equipment to a lead in status '${lead.status}'.` },
            { status: 400 }
          )
        }
        if (lead.equipment_id) {
          return NextResponse.json(
            { error: 'Lead already has equipment linked.' },
            { status: 400 }
          )
        }
        update = { equipment_id }
        break
      }
      default:
        return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const { error: writeErr } = await supabase
      .from('tech_leads')
      .update(update)
      .eq('id', id)
    if (writeErr) {
      console.error('tech-leads update error:', writeErr)
      return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('tech-leads [id]/update POST error:', err)
    return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
  }
}
