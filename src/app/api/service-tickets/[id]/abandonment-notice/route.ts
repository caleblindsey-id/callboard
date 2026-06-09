export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderAbandonmentNoticeEmail } from '@/lib/email-templates/abandonment-notice'

// Manager-initiated final-collection notice for a unit that's sat uncollected
// past the abandonment threshold. Never auto-sent. Requires an email on file —
// no-email units are handled by phone in the Needs Call queue.
const ABANDONMENT_MIN_DAYS = 30
const COLLECTION_DEADLINE_DAYS = 14
const SETTING_KEYS = ['company_name', 'service_phone', 'pickup_address', 'pickup_hours', 'email_from_address']

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createClient()

    const { data: ticket, error } = await supabase
      .from('service_tickets')
      .select(
        `id, customer_id, work_order_number, contact_name, contact_email,
         awaiting_pickup, picked_up_at, ready_for_pickup_at,
         equipment_make, equipment_model, equipment_serial_number,
         equipment(make, model, serial_number, contact_email)`
      )
      .eq('id', id)
      .single()

    if (error || !ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    if (!ticket.awaiting_pickup || ticket.picked_up_at) {
      return NextResponse.json({ error: 'This unit is not awaiting pickup.' }, { status: 409 })
    }

    const daysWaiting = ticket.ready_for_pickup_at
      ? Math.floor((Date.now() - new Date(ticket.ready_for_pickup_at).getTime()) / 86_400_000)
      : null
    if (daysWaiting == null || daysWaiting < ABANDONMENT_MIN_DAYS) {
      return NextResponse.json(
        { error: `An abandonment notice can only be sent after ${ABANDONMENT_MIN_DAYS} days waiting.` },
        { status: 400 }
      )
    }

    const equip = (ticket.equipment as unknown as {
      make: string | null
      model: string | null
      serial_number: string | null
      contact_email: string | null
    } | null) ?? null

    let primaryEmail: string | null = null
    {
      const { data: contact } = await supabase
        .from('contacts')
        .select('email')
        .eq('customer_id', ticket.customer_id)
        .eq('is_primary', true)
        .limit(1)
        .maybeSingle()
      primaryEmail = (contact as { email: string | null } | null)?.email ?? null
    }
    const toEmail = firstNonEmpty(ticket.contact_email, equip?.contact_email, primaryEmail)
    if (!toEmail) {
      return NextResponse.json(
        { error: 'No email on file — call the customer instead (Needs Call queue).' },
        { status: 400 }
      )
    }

    const { data: settingsRows } = await supabase.from('settings').select('key, value').in('key', SETTING_KEYS)
    const settings = new Map<string, string | null>(
      (settingsRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
    )
    const fromEmail = settings.get('email_from_address')
    if (!fromEmail || fromEmail === 'no-reply@example.com') {
      return NextResponse.json({ error: 'Email from-address is not configured.' }, { status: 500 })
    }
    const company = settings.get('company_name')?.trim() || 'Imperial Dade'

    const make = firstNonEmpty(equip?.make, ticket.equipment_make)
    const model = firstNonEmpty(equip?.model, ticket.equipment_model)
    const email = renderAbandonmentNoticeEmail({
      ticket: {
        work_order_number: ticket.work_order_number,
        contact_name: ticket.contact_name,
        equipment_label: [make, model].filter(Boolean).join(' ') || null,
        serial_number: firstNonEmpty(equip?.serial_number, ticket.equipment_serial_number),
        days_waiting: daysWaiting,
      },
      deadlineDays: COLLECTION_DEADLINE_DAYS,
      settings: {
        company_name: company,
        service_phone: settings.get('service_phone') || null,
        pickup_address: settings.get('pickup_address') || null,
        pickup_hours: settings.get('pickup_hours') || null,
      },
    })

    let sendResult: Awaited<ReturnType<typeof sendMandrillEmail>>
    try {
      sendResult = await sendMandrillEmail({
        to: { email: toEmail, name: ticket.contact_name ?? undefined },
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: `${company} Service Department`,
        tags: ['abandonment-notice'],
        metadata: { ticket_id: String(ticket.id), work_order: ticket.work_order_number ? String(ticket.work_order_number) : '' },
      })
    } catch (err) {
      console.error('abandonment-notice: send failed', err)
      const message = err instanceof MandrillError ? err.message : 'Failed to send notice'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const { error: stampError } = await supabase
      .from('service_tickets')
      .update({ abandonment_notice_sent_at: new Date().toISOString() })
      .eq('id', id)
    if (stampError) {
      console.error('abandonment-notice: stamp failed (email already sent)', stampError)
    }

    return NextResponse.json({ ok: true, message_id: sendResult.messageId })
  } catch (err) {
    console.error('service-tickets/[id]/abandonment-notice POST error:', err)
    return NextResponse.json({ error: 'Failed to send abandonment notice' }, { status: 500 })
  }
}
