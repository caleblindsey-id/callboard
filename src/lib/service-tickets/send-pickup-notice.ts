// Shared "your equipment is ready for pickup" sender. Called from the
// service-ticket billed/ready transition (instant, Round 2) and — later — the
// re-notify scanner route (Round 4). One code path so the email + audit trail
// never drift between the two callers.

import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/db/settings'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderPickupReadyEmail } from '@/lib/email-templates/pickup-ready'

export type PickupNoticeResult =
  | { sent: true; messageId: string; notifyCount: number }
  | { sent: false; reason: 'no_email' | 'already_picked_up' | 'not_awaiting' }

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

// Resolves the recipient, renders + sends the email, and stamps the audit
// columns. Throws MandrillError on a send failure (the caller decides whether to
// surface or swallow it). Returns {sent:false} when there's nothing to send
// (no email on file → the unit stays in the "Needs Call" queue; or the unit is
// no longer awaiting pickup).
export async function sendPickupNotice(ticketId: string): Promise<PickupNoticeResult> {
  const supabase = await createClient()

  const { data: ticket, error } = await supabase
    .from('service_tickets')
    .select(
      `id, customer_id, work_order_number, contact_name, contact_email,
       awaiting_pickup, picked_up_at, pickup_notify_count,
       equipment_make, equipment_model, equipment_serial_number,
       customers(name),
       equipment(make, model, serial_number, contact_email)`
    )
    .eq('id', ticketId)
    .single()

  if (error || !ticket) throw new Error(`sendPickupNotice: ticket ${ticketId} not found`)

  if (ticket.picked_up_at) return { sent: false, reason: 'already_picked_up' }
  if (!ticket.awaiting_pickup) return { sent: false, reason: 'not_awaiting' }

  const equip = (ticket.equipment as {
    make: string | null
    model: string | null
    serial_number: string | null
    contact_email: string | null
  } | null) ?? null

  // Resolve recipient email: ticket → equipment → primary contact.
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
  if (!toEmail) return { sent: false, reason: 'no_email' }

  const [companyName, servicePhone, pickupAddress, pickupHours, fromEmail] = await Promise.all([
    getSetting('company_name'),
    getSetting('service_phone'),
    getSetting('pickup_address'),
    getSetting('pickup_hours'),
    getSetting('email_from_address'),
  ])

  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }

  const company = companyName?.trim() || 'Imperial Dade'
  const make = firstNonEmpty(equip?.make, ticket.equipment_make)
  const model = firstNonEmpty(equip?.model, ticket.equipment_model)
  const equipmentLabel = [make, model].filter(Boolean).join(' ') || null
  const serial = firstNonEmpty(equip?.serial_number, ticket.equipment_serial_number)

  const email = renderPickupReadyEmail({
    ticket: {
      work_order_number: ticket.work_order_number,
      contact_name: ticket.contact_name,
      equipment_label: equipmentLabel,
      serial_number: serial,
    },
    settings: {
      company_name: company,
      service_phone: servicePhone || null,
      pickup_address: pickupAddress || null,
      pickup_hours: pickupHours || null,
    },
  })

  const sendResult = await sendMandrillEmail({
    to: { email: toEmail, name: ticket.contact_name ?? undefined },
    subject: email.subject,
    html: email.html,
    text: email.text,
    // Customer sees the branch, not the internal tool name.
    fromName: `${company} Service Department`,
    tags: ['pickup-ready'],
    metadata: {
      ticket_id: String(ticket.id),
      work_order: ticket.work_order_number ? String(ticket.work_order_number) : '',
    },
  })

  const now = new Date().toISOString()
  const notifyCount = (ticket.pickup_notify_count ?? 0) + 1
  const { error: stampError } = await supabase
    .from('service_tickets')
    .update({
      pickup_notified_at: now,
      pickup_notify_message_id: sendResult.messageId,
      pickup_notify_channel: 'email',
      pickup_notify_count: notifyCount,
      pickup_last_notified_at: now,
    })
    .eq('id', ticketId)

  if (stampError) {
    // Email already went out — log so we don't surface a misleading error, but
    // the unit may re-notify next scanner pass since the stamp didn't land.
    console.error('sendPickupNotice: audit stamp failed (email already sent)', stampError)
  }

  return { sent: true, messageId: sendResult.messageId, notifyCount }
}
