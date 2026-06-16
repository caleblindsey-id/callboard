// "A service ticket has been assigned to you" tech notification. Called when a
// ticket is created assigned to a tech (POST /api/service-tickets), reassigned
// to a different tech (PATCH /api/service-tickets/[id]), or bulk-assigned
// (POST /api/service-tickets/bulk-assign). Modeled on sendPartsReadyNotice — one
// code path so the email stays consistent. Email-only in Round 1; this helper is
// the single channel fan-out point (Web Push is added here in Round 2).
//
// Non-fatal by contract: callers await inside a try/catch so a send failure logs
// but never undoes the create/assign write. Self-assignment is suppressed by the
// caller (we never notify a tech about a ticket they assigned to themselves).
//
// Three channels: email (Mandrill) + Web Push + in-app notification (the bell).
// Push and the in-app row are "instant channels" — they fire as soon as the
// recipient is known, BEFORE the email path, so a tech with no deliverable email
// (bench / "inside" techs often don't monitor one) is never silently missed.
// Each is best-effort and wrapped separately so one channel's failure never
// affects another or flips the email result.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import {
  renderServiceTicketAssignedEmail,
  renderServiceTicketsAssignedDigestEmail,
} from '@/lib/email-templates/service-ticket-assigned'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'
import type { ServicePriority } from '@/types/service-tickets'

export type AssignNotifyResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: 'no_tech' | 'no_tech_email' | 'no_tickets' }

const SETTING_KEYS = ['company_name', 'service_phone', 'email_from_address'] as const

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = v?.trim()
    if (t) return t
  }
  return null
}

function ticketUrl(id: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  return base ? `${base}/service/${id}` : null
}

async function loadSettings(supabase: SupabaseClient): Promise<{ company: string; phone: string | null }> {
  const { data: rows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTING_KEYS as unknown as string[])
  const settings = new Map<string, string | null>(
    (rows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  )
  const fromEmail = settings.get('email_from_address')
  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }
  return {
    company: settings.get('company_name')?.trim() || 'Imperial Dade',
    phone: settings.get('service_phone')?.trim() || null,
  }
}

async function loadTech(
  supabase: SupabaseClient,
  techId: string,
): Promise<{ email: string; name: string | null } | null> {
  const { data: tech } = await supabase
    .from('users')
    .select('name, email')
    .eq('id', techId)
    .maybeSingle()
  const email = (tech as { email: string | null } | null)?.email ?? null
  if (!email) return null
  return { email, name: (tech as { name: string | null } | null)?.name ?? null }
}

// Single-ticket assignment (create + reassign). Pass `db` to run under a
// service-role client; omit it to use the request-scoped cookie client.
export async function notifyTechOfAssignment(
  ticketId: string,
  db?: SupabaseClient,
): Promise<AssignNotifyResult> {
  const supabase = db ?? (await createClient())

  type TicketShape = {
    work_order_number: number | null
    assigned_technician_id: string | null
    priority: ServicePriority | null
    problem_description: string | null
    customers: { name: string } | null
    equipment_make: string | null
    equipment_model: string | null
    equipment_serial_number: string | null
    equipment: { make: string | null; model: string | null; serial_number: string | null } | null
  }

  const { data, error } = await supabase
    .from('service_tickets')
    .select('work_order_number, assigned_technician_id, priority, problem_description, customers(name), equipment_make, equipment_model, equipment_serial_number, equipment(make, model, serial_number)')
    .eq('id', ticketId)
    .single()
  const ticket = data as unknown as TicketShape | null
  if (error || !ticket) throw new Error(`notifyTechOfAssignment: ticket ${ticketId} not found`)

  const techId = ticket.assigned_technician_id
  if (!techId) return { sent: false, reason: 'no_tech' }

  // Instant channels — Web Push + the in-app notification bell. These fire here,
  // before the email path, so they reach the tech even when there is no
  // deliverable email (the whole reason the bell exists for bench / "inside"
  // techs). Title/body are derived from ticket data, not the email render, so
  // they don't depend on email-only settings. Both best-effort.
  const woLabel = ticket.work_order_number ? `WO-${ticket.work_order_number}` : null
  const alertTitle = `${ticket.priority === 'emergency' ? 'EMERGENCY service ticket' : 'New service ticket'} assigned — ${woLabel ?? 'new ticket'}`
  const alertBody =
    [ticket.customers?.name ?? null, ticket.problem_description?.trim() || null].filter(Boolean).join(' — ') ||
    'A service ticket was assigned to you.'
  const alertUrl = ticketUrl(ticketId) ?? '/service'

  try {
    await sendPushToUser(techId, { title: alertTitle, body: alertBody, url: alertUrl, tag: `assign-${ticketId}` })
  } catch (err) {
    console.error('notifyTechOfAssignment: push send failed', err)
  }

  try {
    await createNotification(techId, {
      type: 'service_ticket_assigned',
      title: alertTitle,
      body: alertBody,
      url: alertUrl,
      entityType: 'service_ticket',
      entityId: ticketId,
    })
  } catch (err) {
    console.error('notifyTechOfAssignment: in-app notification failed', err)
  }

  const tech = await loadTech(supabase, techId)
  if (!tech) return { sent: false, reason: 'no_tech_email' }

  const { company, phone } = await loadSettings(supabase)

  // Machine label: COALESCE inline equipment_* over the linked equipment row
  // (mirrors sendPartsReadyNotice / the parts_order_queue view).
  const eq = ticket.equipment ?? null
  const make = firstNonEmpty(ticket.equipment_make, eq?.make)
  const model = firstNonEmpty(ticket.equipment_model, eq?.model)
  const serial = firstNonEmpty(ticket.equipment_serial_number, eq?.serial_number)
  const head = [make, model].filter(Boolean).join(' ')
  const machineLabel = [head, serial ? `S/N ${serial}` : ''].filter(Boolean).join(' — ') || null

  const email = renderServiceTicketAssignedEmail({
    ticket: {
      work_order_number: ticket.work_order_number,
      tech_first_name: tech.name?.split(' ')[0] ?? null,
      customer_name: ticket.customers?.name ?? null,
      priority: ticket.priority ?? 'standard',
      problem_description: ticket.problem_description,
      machine_label: machineLabel,
      url: ticketUrl(ticketId),
    },
    settings: { company_name: company, service_phone: phone },
  })

  const sendResult = await sendMandrillEmail({
    to: { email: tech.email, name: tech.name ?? undefined },
    subject: email.subject,
    html: email.html,
    text: email.text,
    fromName: `${company} Service Department`,
    tags: ['service-ticket-assigned'],
    metadata: {
      ticket_id: String(ticketId),
      work_order: ticket.work_order_number ? String(ticket.work_order_number) : '',
    },
  })

  // Audit (non-fatal — the email already sent).
  try {
    await supabase
      .from('service_tickets')
      .update({
        assigned_notified_at: new Date().toISOString(),
        assigned_notify_message_id: sendResult.messageId,
      })
      .eq('id', ticketId)
  } catch (err) {
    console.error('notifyTechOfAssignment: audit write failed', err)
  }

  return { sent: true, messageId: sendResult.messageId }
}

// Bulk assignment: many tickets → one technician → one digest email.
export async function notifyTechOfBulkAssignment(
  technicianId: string,
  ticketIds: string[],
  db?: SupabaseClient,
): Promise<AssignNotifyResult> {
  if (ticketIds.length === 0) return { sent: false, reason: 'no_tickets' }
  const supabase = db ?? (await createClient())

  const { data: rows } = await supabase
    .from('service_tickets')
    .select('id, work_order_number, customers(name)')
    .in('id', ticketIds)
  type RowShape = { id: string; work_order_number: number | null; customers: { name: string } | null }
  const tickets = ((rows as unknown as RowShape[] | null) ?? [])
  if (tickets.length === 0) return { sent: false, reason: 'no_tickets' }

  // Instant channels — Web Push + the in-app bell, fired before the email path so
  // they reach a tech with no deliverable email. One summary per batch.
  const boardUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/service`
    : '/service'
  const bulkTitle = `${tickets.length} new service ticket${tickets.length === 1 ? '' : 's'} assigned`
  const bulkBody = `${tickets.length} service ticket${tickets.length === 1 ? '' : 's'} assigned to you.`

  try {
    await sendPushToUser(technicianId, { title: bulkTitle, body: bulkBody, url: boardUrl })
  } catch (err) {
    console.error('notifyTechOfBulkAssignment: push send failed', err)
  }

  try {
    await createNotification(technicianId, {
      type: 'service_ticket_assigned',
      title: bulkTitle,
      body: bulkBody,
      url: boardUrl,
      entityType: 'service_ticket',
      entityId: null,
    })
  } catch (err) {
    console.error('notifyTechOfBulkAssignment: in-app notification failed', err)
  }

  const tech = await loadTech(supabase, technicianId)
  if (!tech) return { sent: false, reason: 'no_tech_email' }

  const { company, phone } = await loadSettings(supabase)

  const email = renderServiceTicketsAssignedDigestEmail({
    tech_first_name: tech.name?.split(' ')[0] ?? null,
    tickets: tickets.map((t) => ({
      work_order_number: t.work_order_number,
      customer_name: t.customers?.name ?? null,
      url: ticketUrl(t.id),
    })),
    board_url: process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/service`
      : null,
    settings: { company_name: company, service_phone: phone },
  })

  const sendResult = await sendMandrillEmail({
    to: { email: tech.email, name: tech.name ?? undefined },
    subject: email.subject,
    html: email.html,
    text: email.text,
    fromName: `${company} Service Department`,
    tags: ['service-ticket-assigned'],
    metadata: { technician_id: technicianId, ticket_count: String(tickets.length) },
  })

  // Audit (non-fatal): stamp every ticket in the batch.
  try {
    await supabase
      .from('service_tickets')
      .update({
        assigned_notified_at: new Date().toISOString(),
        assigned_notify_message_id: sendResult.messageId,
      })
      .in('id', tickets.map((t) => t.id))
  } catch (err) {
    console.error('notifyTechOfBulkAssignment: audit write failed', err)
  }

  return { sent: true, messageId: sendResult.messageId }
}
