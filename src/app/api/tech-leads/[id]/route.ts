import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import type { TechLeadUpdate } from '@/types/database'
import { validateLeadFields, type LeadFieldsInput } from '@/lib/tech-leads/validate-lead'

// PATCH /api/tech-leads/[id] — the submitter edits their own lead while it is
// still `pending` (before a manager approves/rejects/cancels). Managers+ may
// also edit a pending lead's fields. Status transitions remain on the
// manager-only /update route; this route never changes status, ownership, or
// the equipment-sale expiry window.
//
// tech_leads RLS grants techs no UPDATE policy by design (see migration 037 /
// the photos route), so — like the photos route — we enforce ownership + the
// pending gate here and write with the admin client.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data: lead, error: fetchErr } = await supabase
      .from('tech_leads')
      .select('id, submitted_by, status, lead_type')
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }

    const isOwner = lead.submitted_by === user.id
    const isManager = MANAGER_ROLES.includes(user.role)
    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (lead.status !== 'pending') {
      return NextResponse.json(
        { error: 'This lead has already been reviewed and can no longer be edited.' },
        { status: 409 }
      )
    }

    const body = (await request.json()) as LeadFieldsInput

    // Switching lead type post-submission would drag in expires_at / equipment
    // handling — out of scope. Default an omitted type to the existing one.
    const requestedType = body.lead_type ?? lead.lead_type
    if (requestedType !== lead.lead_type) {
      return NextResponse.json(
        { error: 'Lead type cannot be changed. Cancel and submit a new lead instead.' },
        { status: 400 }
      )
    }

    const validated = validateLeadFields({ ...body, lead_type: lead.lead_type })
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status })
    }
    const f = validated.fields

    // Only the tech-editable content fields. status, submitted_by/at,
    // approval/earn columns, expires_at and photos are intentionally untouched.
    const update: TechLeadUpdate = {
      customer_id: f.customer_id,
      customer_name_text: f.customer_name_text,
      notes: f.notes,
      contact_name: f.contact_name,
      contact_email: f.contact_email,
      contact_phone: f.contact_phone,
      equipment_description: f.equipment_description,
      make: f.make,
      model: f.model,
      serial_number: f.serial_number,
      location_on_site: f.location_on_site,
      proposed_start_month: f.proposed_start_month,
      proposed_start_year: f.proposed_start_year,
      proposed_pm_frequency: f.proposed_pm_frequency,
      proposed_equipment_tier: f.proposed_equipment_tier,
    }

    // Admin write — ownership + role already enforced above. The status guard
    // is repeated in the WHERE so a manager approving between our read and this
    // write can't be silently overwritten back to the edited content.
    const admin = await createAdminClient('SERVER_ONLY')
    const { data: written, error: writeErr } = await admin
      .from('tech_leads')
      .update(update)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
    if (writeErr) {
      console.error('tech-leads [id] PATCH error:', writeErr)
      return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
    }
    if (!written || written.length === 0) {
      return NextResponse.json(
        { error: 'This lead has already been reviewed and can no longer be edited.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('tech-leads [id] PATCH unhandled:', err)
    return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
  }
}
