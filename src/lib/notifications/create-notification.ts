// In-app notification writer — the third channel of tech assignment
// notifications (after email + Web Push). Writes a durable row the notification
// bell reads, so bench / "inside" techs who don't watch email still see the
// ticket the moment they open the app.
//
// Writes under the service-role client (like sendPushToUser): the assignment
// caller is the manager/creator, not the recipient, and notifications RLS has no
// INSERT policy — rows are server-written only. Best-effort by contract: callers
// wrap in try/catch so a write failure never undoes the create/assign.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { NotificationInsert } from '@/types/database'

export type CreateNotificationInput = {
  type: string
  title: string
  body?: string | null
  url?: string | null
  entityType?: string | null
  entityId?: string | null
}

function toRow(userId: string, input: CreateNotificationInput): NotificationInsert {
  return {
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
  }
}

// Single recipient. Returns the new row id, or null if the insert no-ops/fails.
export async function createNotification(
  userId: string,
  input: CreateNotificationInput,
): Promise<string | null> {
  const admin = await createAdminClient('SERVER_ONLY')
  const { data, error } = await admin
    .from('notifications')
    .insert(toRow(userId, input))
    .select('id')
    .single()
  if (error) {
    console.error('createNotification: insert failed', error)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

// Many recipients in one round-trip (e.g. fan-out to a group). Each entry pairs a
// recipient with the notification to write.
export async function createNotifications(
  entries: Array<{ userId: string; input: CreateNotificationInput }>,
): Promise<number> {
  if (entries.length === 0) return 0
  const admin = await createAdminClient('SERVER_ONLY')
  const rows = entries.map((e) => toRow(e.userId, e.input))
  const { data, error } = await admin.from('notifications').insert(rows).select('id')
  if (error) {
    console.error('createNotifications: insert failed', error)
    return 0
  }
  return (data as { id: string }[] | null)?.length ?? 0
}
