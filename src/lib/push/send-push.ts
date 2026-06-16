// Web Push delivery. Sends a notification to every device a user has subscribed
// from, and prunes subscriptions the push service reports as gone (404/410).
// Reads subscriptions under the service-role client because the caller (the
// assignment-notify path) runs as the manager/creator, not the target tech, and
// RLS scopes push_subscriptions to the owner. No-op (returns) when VAPID is not
// configured, so non-push environments don't throw.

import 'server-only'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  icon?: string
}

export type SendPushResult = {
  configured: boolean
  sent: number
  pruned: number
}

let vapidReady: boolean | null = null

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:service@imperialdade.com'
  if (!publicKey || !privateKey) {
    vapidReady = false
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidReady = true
  return true
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string }

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendPushResult> {
  if (!ensureVapid()) return { configured: false, sent: 0, pruned: 0 }

  const admin = await createAdminClient('SERVER_ONLY')
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  const rows = (subs as SubRow[] | null) ?? []
  if (rows.length === 0) return { configured: true, sent: 0, pruned: 0 }

  const body = JSON.stringify(payload)
  const deadIds: string[] = []
  const sentIds: string[] = []

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        )
        sentIds.push(row.id)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        // 404/410 = subscription expired or unsubscribed — drop it so we stop
        // hammering a dead endpoint. Other errors are transient; leave the row.
        if (statusCode === 404 || statusCode === 410) {
          deadIds.push(row.id)
        } else {
          console.error('sendPushToUser: send failed', statusCode ?? err)
        }
      }
    }),
  )

  if (deadIds.length > 0) {
    try {
      await admin.from('push_subscriptions').delete().in('id', deadIds)
    } catch (err) {
      console.error('sendPushToUser: prune failed', err)
    }
  }

  if (sentIds.length > 0) {
    try {
      await admin
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .in('id', sentIds)
    } catch {
      /* non-fatal freshness stamp */
    }
  }

  return { configured: true, sent: sentIds.length, pruned: deadIds.length }
}
