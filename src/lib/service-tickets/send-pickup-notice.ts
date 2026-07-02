// Shared "your equipment is ready for pickup" sender. Called from the
// service-ticket billed/ready transition (instant, Round 2) and — later — the
// re-notify scanner route (Round 4). One code path so the email + audit trail
// never drift between the two callers.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderPickupReadyEmail } from '@/lib/email-templates/pickup-ready'

export type PickupNoticeResult =
  | { sent: true; messageId: string; notifyCount: number }
  | { sent: false; reason: 'no_email' | 'already_picked_up' | 'not_awaiting' }

const SETTING_KEYS = ['company_name', 'service_phone', 'pickup_address', 'pickup_hours', 'email_from_address'] as const

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
// Pass `db` to run under a service-role client (the cron re-notify path has no
// user session); omit it to use the request-scoped cookie client (the instant
// billed-transition path, which already runs as a manager).
export async function sendPickupNotice(
  ticketId: string,
  db?: SupabaseClient,
): Promise<PickupNoticeResult> {
  const supabase = db ?? (await createClient())

  const { data: ticket, error } = await supabase
    .from('service_tickets')
    .select(
      `id, customer_id, status, work_order_number, contact_name, contact_email,
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

  const equip = (ticket.equipment as unknown as {
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

  // Read settings through the same client so the cron (service-role) path isn't
  // blocked by RLS the way a getSetting() cookie client would be.
  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTING_KEYS as unknown as string[])
  const settings = new Map<string, string | null>(
    (settingsRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  )
  const companyName = settings.get('company_name')
  const servicePhone = settings.get('service_phone')
  const pickupAddress = settings.get('pickup_address')
  const pickupHours = settings.get('pickup_hours')
  const fromEmail = settings.get('email_from_address')

  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }

  const company = companyName?.trim() || 'Imperial Dade'
  const make = firstNonEmpty(equip?.make, ticket.equipment_make)
  const model = firstNonEmpty(equip?.model, ticket.equipment_model)
  const equipmentLabel = [make, model].filter(Boolean).join(' ') || null
  const serial = firstNonEmpty(equip?.serial_number, ticket.equipment_serial_number)

  const email = renderPickupReadyEmail({
    // A staged unit that never reached 'billed' is a declined estimate (unit
    // ready to collect as-is); 'billed' is the repaired flow.
    outcome: ticket.status === 'billed' ? 'repaired' : 'declined',
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
