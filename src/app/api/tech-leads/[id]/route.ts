import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/auth'
import type { TechLeadUpdate } from '@/types/database'
import { validateLeadFields, type LeadFieldsInput } from '@/lib/tech-leads/validate-lead'
import { evaluateLeadEditPermission } from '@/lib/tech-leads/edit-permissions'

// PATCH /api/tech-leads/[id] — edit a lead's content fields.
//   - The submitter (owner) or any manager role may edit while `pending`.
//   - super_admin/manager may ALSO correct an `approved` / `match_pending`
//     equipment-sale lead — e.g. fixing the wrong customer account on an
//     awaiting-match lead (feedback #74). See evaluateLeadEditPermission.
// Status transitions stay on the manager-only /update route; this route never
// changes status (except the match_pending→approved re-arm below), ownership, or
// the equipment-sale expiry window.
//
// tech_leads RLS grants techs no UPDATE policy by design (see migration 037 /
// the photos route), so — like the photos route — we enforce the edit gate here
// and write with the admin client.
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
      .select('id, submitted_by, status, lead_type, customer_id')
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }

    const permission = evaluateLeadEditPermission({
      isOwner: lead.submitted_by === user.id,
      role: user.role,
      status: lead.status,
      leadType: lead.lead_type,
    })
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.error }, { status: permission.status })
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

    // Admin write — the edit gate is already enforced above. The WHERE repeats
    // the exact status we validated against, so a concurrent transition (a scan
    // flipping approved→match_pending, a confirm earning the lead, an approve)
    // between our read and this write matches 0 rows and 409s instead of being
    // silently clobbered.
    const admin = await createAdminClient('SERVER_ONLY')
    const { data: written, error: writeErr } = await admin
      .from('tech_leads')
      .update(update)
      .eq('id', id)
      .eq('status', lead.status)
      .select('id')
    if (writeErr) {
      console.error('tech-leads [id] PATCH error:', writeErr)
      return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
    }
    if (!written || written.length === 0) {
      return NextResponse.json(
        { error: 'This lead was updated by someone else — reopen it and try again.' },
        { status: 409 }
      )
    }

    // Correcting the customer on an awaiting-match equipment-sale lead (feedback
    // #74) invalidates any candidates detected against the OLD account, so dismiss
    // pending ones and re-arm a match_pending lead back to approved. The nightly
    // scan then re-evaluates against the corrected account. Only runs when the
    // account actually changed on a non-pending equipment-sale lead.
    const customerChanged = lead.customer_id !== f.customer_id
    if (lead.lead_type === 'equipment_sale' && lead.status !== 'pending' && customerChanged) {
      const nowIso = new Date().toISOString()
      // Best-effort: the account is already corrected above; a failure here only
      // leaves stale candidates the manager can dismiss, so we log rather than
      // fail the edit.
      const { error: dismissErr } = await admin
        .from('equipment_sale_lead_candidates')
        .update({ status: 'dismissed', reviewed_by: user.id, reviewed_at: nowIso })
        .eq('tech_lead_id', id)
        .eq('status', 'pending')
      if (dismissErr) console.error('tech-leads [id] PATCH candidate dismiss error:', dismissErr)
      if (lead.status === 'match_pending') {
        const { error: rearmErr } = await admin
          .from('tech_leads')
          .update({ status: 'approved' })
          .eq('id', id)
          .eq('status', 'match_pending')
        if (rearmErr) console.error('tech-leads [id] PATCH re-arm error:', rearmErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('tech-leads [id] PATCH unhandled:', err)
    return NextResponse.json({ error: 'Failed to update lead.' }, { status: 500 })
  }
}
