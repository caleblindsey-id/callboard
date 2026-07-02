// "Your parts are ready for pickup" tech notification. Called from the
// parts-queue update route after a part action tips a ticket into the fully-
// staged state (every live part received from a PO or pulled from stock).
// Three channels, each best-effort/non-fatal (push -> in-app bell -> email),
// mirroring the assignment and supply-ready notices — a bench tech with no
// email on file still gets the push + bell instead of silently nothing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderPartsReadyEmail } from '@/lib/email-templates/parts-ready'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'
import { partLabel } from '@/lib/parts'
import type { PartRequest, PartsQueueSource } from '@/types/database'

export type PartsReadyResult =
  | { sent: true; messageId: string }
  | { sent: true; messageId: null }            // push/in-app went out, email skipped (no tech email)
  | { sent: false; reason: 'no_tech' | 'no_staged_parts' }

const SETTING_KEYS = ['company_name', 'service_phone', 'pickup_address', 'pickup_hours', 'email_from_address'] as const

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

// Pass `db` to run under a service-role client (no user session); omit it to use
// the request-scoped cookie client (the parts-queue route runs as a manager).
export async function sendPartsReadyNotice(
  source: PartsQueueSource,
  ticketId: string,
  db?: SupabaseClient,
): Promise<PartsReadyResult> {
  const supabase = db ?? (await createClient())

  // Normalized shape across both ticket tables. Two literal-select queries (not a
  // dynamic string) so the supabase type parser stays happy; cast through unknown.
  type TicketShape = {
    work_order_number: number | null
    assigned_technician_id: string | null
    parts_requested: PartRequest[] | null
    customers: { name: string } | null
    equipment: { make: string | null; model: string | null; serial_number: string | null } | null
    equipment_make?: string | null
    equipment_model?: string | null
    equipment_serial_number?: string | null
  }

  let ticket: TicketShape | null
  let error: unknown
  if (source === 'pm') {
    const r = await supabase
      .from('pm_tickets')
      .select('work_order_number, assigned_technician_id, parts_requested, customers(name), equipment(make, model, serial_number)')
      .eq('id', ticketId)
      .single()
    ticket = r.data as unknown as TicketShape | null
    error = r.error
  } else {
    const r = await supabase
      .from('service_tickets')
      .select('work_order_number, assigned_technician_id, parts_requested, customers(name), equipment_make, equipment_model, equipment_serial_number, equipment(make, model, serial_number)')
      .eq('id', ticketId)
      .single()
    ticket = r.data as unknown as TicketShape | null
    error = r.error
  }

  if (error || !ticket) throw new Error(`sendPartsReadyNotice: ticket ${ticketId} not found`)

  const techId = ticket.assigned_technician_id
  if (!techId) return { sent: false, reason: 'no_tech' }

  // Staged parts only — received (from a PO) or pulled (from stock). These are
  // the lines physically waiting for the tech at the shop.
  const parts = (ticket.parts_requested ?? []) as PartRequest[]
  const staged = parts.filter(
    (p) => !p.cancelled && (p.status === 'received' || (p.status === 'from_stock' && p.pulled_at)),
  )
  if (staged.length === 0) return { sent: false, reason: 'no_staged_parts' }

  const wo = ticket.work_order_number
  const instantTitle = 'Parts ready for pickup'
  const instantBody = [
    wo != null ? `WO#${wo}` : null,
    staged.length === 1 ? (partLabel(staged[0]) || staged[0].description) : `${staged.length} parts staged`,
  ].filter(Boolean).join(' — ')

  // --- Channel 1: Web Push (instant, best-effort) ---
  try {
    await sendPushToUser(techId, {
      title: instantTitle,
      body: instantBody,
      url: '/my-parts',
      tag: `parts-ready-${ticketId}`,
    })
  } catch (err) {
    console.error('parts-ready push failed:', err)
  }

  // --- Channel 2: in-app bell (instant, best-effort) ---
  try {
    await createNotification(techId, {
      type: 'parts_ready',
      title: instantTitle,
      body: instantBody,
      url: '/my-parts',
      entityType: source === 'pm' ? 'pm_ticket' : 'service_ticket',
      entityId: ticketId,
    })
  } catch (err) {
    console.error('parts-ready in-app notification failed:', err)
  }

  // --- Channel 3: email (best-effort; skipped when no address on file) ---
  const { data: tech } = await supabase
    .from('users')
    .select('name, email')
    .eq('id', techId)
    .maybeSingle()
  const techEmail = (tech as { email: string | null } | null)?.email ?? null
  if (!techEmail) return { sent: true, messageId: null }
  const techName = (tech as { name: string | null } | null)?.name ?? null

  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTING_KEYS as unknown as string[])
  const settings = new Map<string, string | null>(
    (settingsRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  )
  const companyName = settings.get('company_name')
  const fromEmail = settings.get('email_from_address')
  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }
  const company = companyName?.trim() || 'Imperial Dade'

  // Machine label: PM reads the linked equipment row; service COALESCEs inline
  // equipment_* over the linked row (mirrors the parts_order_queue view).
  const eq = ticket.equipment ?? null
  const make = firstNonEmpty(ticket.equipment_make, eq?.make)
  const model = firstNonEmpty(ticket.equipment_model, eq?.model)
  const serial = firstNonEmpty(ticket.equipment_serial_number, eq?.serial_number)
  const head = [make, model].filter(Boolean).join(' ')
  const machineLabel = [head, serial ? `S/N ${serial}` : ''].filter(Boolean).join(' — ') || null

  const customer = ticket.customers?.name ?? null

  const email = renderPartsReadyEmail({
    ticket: {
      work_order_number: ticket.work_order_number,
      tech_first_name: techName?.split(' ')[0] ?? null,
      customer_name: customer,
      machine_label: machineLabel,
    },
    parts: staged.map((p) => ({ description: partLabel(p) || p.description, quantity: p.quantity ?? null })),
    settings: {
      company_name: company,
      service_phone: settings.get('service_phone') || null,
      pickup_address: settings.get('pickup_address') || null,
      pickup_hours: settings.get('pickup_hours') || null,
    },
  })

  const sendResult = await sendMandrillEmail({
    to: { email: techEmail, name: techName ?? undefined },
    subject: email.subject,
    html: email.html,
    text: email.text,
    fromName: `${company} Service Department`,
    tags: ['parts-ready'],
    metadata: {
      ticket_id: String(ticketId),
      source,
      work_order: ticket.work_order_number ? String(ticket.work_order_number) : '',
    },
  })

  return { sent: true, messageId: sendResult.messageId }
}
