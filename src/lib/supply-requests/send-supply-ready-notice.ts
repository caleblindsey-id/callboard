// "Your shop supplies are ready for pickup" tech notification. Called from the
// supply-requests PATCH route when a request is marked ready. Three channels,
// each best-effort/non-fatal (push -> in-app -> email), mirroring the assignment
// and parts-ready notices. Stamps ready_notified_at as the dedup anchor.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sendMandrillEmail, MandrillError } from '@/lib/mandrill'
import { renderSupplyReadyEmail } from '@/lib/email-templates/supply-ready'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'
import type { SupplyRequestItem } from '@/types/database'

export type SupplyReadyResult =
  | { sent: true; messageId: string }
  | { sent: true; messageId: null }            // push/in-app went out, email skipped (no tech email)
  | { sent: false; reason: 'not_found' | 'no_tech' | 'already_notified' }

const SETTING_KEYS = ['company_name', 'service_phone', 'pickup_address', 'pickup_hours', 'email_from_address'] as const

// Pass `db` to reuse the request-scoped client (the route runs as a manager, who
// can read the request and stamp it); omit to use a fresh cookie client.
export async function sendSupplyReadyNotice(
  requestId: string,
  db?: SupabaseClient,
): Promise<SupplyReadyResult> {
  const supabase = db ?? (await createClient())

  const { data: req, error } = await supabase
    .from('supply_requests')
    .select('id, requested_by, items, status, ready_notified_at')
    .eq('id', requestId)
    .single()
  if (error || !req) return { sent: false, reason: 'not_found' }
  if (req.ready_notified_at) return { sent: false, reason: 'already_notified' }

  const techId = req.requested_by as string | null
  if (!techId) return { sent: false, reason: 'no_tech' }

  const items = ((req.items ?? []) as SupplyRequestItem[]).map((it) => ({
    name: it.name,
    quantity: Number(it.quantity) || 1,
    unit: it.unit ?? null,
  }))

  // --- Channel 1: Web Push (instant, best-effort) ---
  const pushBody = items.length === 1 ? items[0].name : `${items.length} items`
  try {
    await sendPushToUser(techId, {
      title: 'Shop supplies ready for pickup',
      body: pushBody,
      url: '/my-supplies',
      tag: `supply-ready-${requestId}`,
    })
  } catch (err) {
    console.error('supply-ready push failed:', err)
  }

  // --- Channel 2: in-app bell (instant, best-effort) ---
  try {
    await createNotification(techId, {
      type: 'supply_request_ready',
      title: 'Shop supplies ready for pickup',
      body: pushBody,
      url: '/my-supplies',
      entityType: 'supply_request',
      entityId: requestId,
    })
  } catch (err) {
    console.error('supply-ready in-app notification failed:', err)
  }

  // Stamp the dedup anchor now that the instant channels have fired, so a retry
  // or a double-click can't re-notify even if the email below throws.
  try {
    await supabase.from('supply_requests').update({ ready_notified_at: new Date().toISOString() }).eq('id', requestId)
  } catch (err) {
    console.error('supply-ready stamp failed:', err)
  }

  // --- Channel 3: email (best-effort) ---
  const { data: tech } = await supabase.from('users').select('name, email').eq('id', techId).maybeSingle()
  const techEmail = (tech as { email: string | null } | null)?.email ?? null
  const techName = (tech as { name: string | null } | null)?.name ?? null
  if (!techEmail) return { sent: true, messageId: null }

  const { data: settingsRows } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', SETTING_KEYS as unknown as string[])
  const settings = new Map<string, string | null>(
    (settingsRows ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value]),
  )
  const fromEmail = settings.get('email_from_address')
  if (!fromEmail || fromEmail === 'no-reply@example.com') {
    // Email not configured — push + in-app already went out, so this isn't fatal.
    throw new MandrillError('Email from-address has not been configured. Update settings.email_from_address.')
  }
  const company = settings.get('company_name')?.trim() || 'Imperial Dade'

  const email = renderSupplyReadyEmail({
    tech_first_name: techName?.split(' ')[0] ?? null,
    items,
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
    tags: ['supply-ready'],
    metadata: { supply_request_id: String(requestId) },
  })

  return { sent: true, messageId: sendResult.messageId }
}
