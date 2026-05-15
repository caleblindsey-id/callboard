import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, RESET_ROLES } from '@/lib/auth'
import { getSalesRepsByIds } from '@/lib/db/sales-reps'
import { getSetting } from '@/lib/db/settings'
import { sendMandrillEmail } from '@/lib/mandrill'
import { renderLeadToSalesRepEmail } from '@/lib/email-templates/lead-to-sales-rep'
import type { TicketPhoto } from '@/types/database'

const NOTE_MAX = 500
const CC_MAX = 10
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7 // 7 days
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ReqBody = {
  sales_rep_id?: string
  cc_ids?: string[]
  note?: string
}

// Retry-safe (Postgres txn) — the durable approval flip + email-audit columns
// are written by fn_approve_tech_lead_email (migration 074). The Mandrill
// send still happens first so a failed email aborts approval; an RPC failure
// after a successful send returns 409/500 and leaves the lead pending.
//
// POST /api/tech-leads/[id]/approve-and-email
// Approves an equipment-sale lead AND emails it to a selected sales rep in one
// shot. Email is sent BEFORE the DB flip so a Mandrill failure cancels the
// approval. Idempotency: refuses if emailed_to_rep_at IS already set.
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

    const body = (await request.json()) as ReqBody
    const salesRepId = typeof body.sales_rep_id === 'string' ? body.sales_rep_id : ''
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''
    const rawCcIds = Array.isArray(body.cc_ids) ? body.cc_ids : []

    if (!salesRepId || !UUID_RE.test(salesRepId)) {
      return NextResponse.json({ error: 'A valid sales_rep_id is required' }, { status: 400 })
    }

    // Dedupe, drop the primary if it appears, validate UUID format, cap length.
    const ccIds = Array.from(
      new Set(
        rawCcIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v) && v !== salesRepId)
      )
    )
    if (ccIds.length > CC_MAX) {
      return NextResponse.json({ error: `Up to ${CC_MAX} CC recipients allowed` }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: lead, error: fetchErr } = await supabase
      .from('tech_leads')
      .select(`
        id, status, lead_type, equipment_description, notes,
        customer_id, customer_name_text,
        contact_name, contact_email, contact_phone,
        photos, emailed_to_rep_at,
        submitter:users!tech_leads_submitted_by_fkey(id, name),
        customers(id, name)
      `)
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }

    if (lead.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot approve a lead in status '${lead.status}'.` },
        { status: 409 }
      )
    }
    if (lead.lead_type !== 'equipment_sale') {
      return NextResponse.json(
        { error: 'Email-to-rep is only supported for equipment-sale leads.' },
        { status: 400 }
      )
    }
    if (lead.emailed_to_rep_at) {
      return NextResponse.json(
        { error: 'This lead has already been emailed to a rep.' },
        { status: 409 }
      )
    }

    const allReps = await getSalesRepsByIds([salesRepId, ...ccIds])
    const repsById = new Map(allReps.map(r => [r.id, r]))
    const primary = repsById.get(salesRepId)
    if (!primary || !primary.active) {
      return NextResponse.json(
        { error: 'Selected sales rep is unavailable.' },
        { status: 404 }
      )
    }
    const ccReps = ccIds.map(id => repsById.get(id))
    if (ccReps.some(r => !r || !r.active)) {
      return NextResponse.json(
        { error: 'One or more CC recipients are unavailable.' },
        { status: 400 }
      )
    }
    const validCcReps = ccReps.filter((r): r is NonNullable<typeof r> => !!r)

    // Sign 7-day URLs for any attached machine photos. Service-role client
    // bypasses the storage RLS that would otherwise block manager reads.
    const admin = await createAdminClient('ADMIN_ONLY')
    const photos = (lead.photos ?? []) as TicketPhoto[]
    const signedPhotoUrls: string[] = []
    for (const p of photos) {
      const { data, error } = await admin.storage
        .from('ticket-photos')
        .createSignedUrl(p.storage_path, SIGNED_URL_TTL_SEC)
      if (error || !data?.signedUrl) {
        console.warn('approve-and-email: failed to sign photo', p.storage_path, error)
        continue
      }
      signedPhotoUrls.push(data.signedUrl)
    }

    const submitter = Array.isArray(lead.submitter) ? lead.submitter[0] : lead.submitter
    const customers = Array.isArray(lead.customers) ? lead.customers[0] : lead.customers
    const techName = submitter?.name ?? 'A technician'
    const customerName =
      customers?.name ?? lead.customer_name_text ?? 'Unknown customer'

    const companyName = (await getSetting('company_name')) || 'CallBoard'

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    const leadDeepLink = appUrl
      ? `${appUrl}/tech-payouts?lead=${id}`
      : `/tech-payouts?lead=${id}`

    const { subject, html, text } = renderLeadToSalesRepEmail({
      primary: { name: primary.name, kind: primary.kind },
      ccNames: validCcReps.map(r => r.name),
      techName,
      customerName,
      contact: {
        name: lead.contact_name,
        email: lead.contact_email,
        phone: lead.contact_phone,
      },
      equipmentDescription: lead.equipment_description,
      notes: lead.notes,
      signedPhotoUrls,
      leadDeepLink,
      optionalNote: note || null,
      companyName,
    })

    let messageId: string
    let mandrillStatus: 'sent' | 'queued' | 'scheduled'
    try {
      const result = await sendMandrillEmail({
        to: { email: primary.email, name: primary.name },
        cc: validCcReps.map(r => ({ email: r.email, name: r.name })),
        subject,
        html,
        text,
        tags: ['tech-lead-rep-forward'],
        metadata: { tech_lead_id: id, sales_rep_id: primary.id },
      })
      messageId = result.messageId
      mandrillStatus = result.status
    } catch (err) {
      console.error('approve-and-email: Mandrill send failed', err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to send email' },
        { status: 502 }
      )
    }

    // Status-guarded update via fn_approve_tech_lead_email (migration 074).
    // The function raises STATUS_CONFLICT (40001) when the lead is no longer
    // pending OR has already been emailed — both surface as 409 here. Email
    // is already sent by this point, so the user sees the "email sent but
    // already approved" message.
    const { error: rpcErr } = await supabase.rpc('fn_approve_tech_lead_email', {
      p_lead_id: id,
      p_approver_id: user.id,
      p_rep_id: primary.id,
      p_cc_ids: validCcReps.map(r => r.id),
      p_message_id: messageId,
    })

    if (rpcErr) {
      if (rpcErr.code === '40001') {
        return NextResponse.json(
          {
            error:
              'Email was sent, but the lead was already approved by someone else. No further action needed.',
          },
          { status: 409 }
        )
      }
      console.error('approve-and-email: RPC failed after send', rpcErr)
      return NextResponse.json(
        { error: 'Email sent, but failed to record approval. Contact support.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message_id: messageId,
      status: mandrillStatus,
      rep: { id: primary.id, name: primary.name, email: primary.email },
      cc: validCcReps.map(r => ({ id: r.id, name: r.name, email: r.email })),
    })
  } catch (err) {
    console.error('POST /api/tech-leads/[id]/approve-and-email error:', err)
    return NextResponse.json({ error: 'Failed to approve and email lead' }, { status: 500 })
  }
}
