import { createClient } from '@/lib/supabase/server'
import type {
  AuditEvent,
  AuditEventWithActor,
  AuditActorType,
  AuditAction,
} from '@/lib/audit/format'

// The audit_events table is created by migration 058 — it isn't yet known to
// the Supabase generated types. Cast .from() through `unknown` per the
// existing pattern (e.g. tickets.ts:233). Once `supabase gen types` runs
// after the migration applies, the casts can drop.

export type AuditFilters = {
  entityType?: string
  entityId?: string
  entityIds?: string[]  // restricts entity_id to this set (used for WO# resolution)
  changedBy?: string
  action?: AuditAction
  actorType?: AuditActorType
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

type AuditEventRow = AuditEvent & {
  user_actor: { id: string; name: string; role: string | null } | null
}

function rowToEvent(row: AuditEventRow): AuditEventWithActor {
  const { user_actor, ...rest } = row
  return { ...rest, actor: user_actor }
}

// Loosely-typed builder helper so we don't fight the generated types for a
// table that isn't generated yet.
function audit(supabase: Awaited<ReturnType<typeof createClient>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from('audit_events')
}

export async function listAuditEvents(
  filters: AuditFilters = {}
): Promise<{ events: AuditEventWithActor[]; total: number }> {
  const supabase = await createClient()
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0

  let query = audit(supabase)
    .select(
      `
        id, occurred_at, entity_type, entity_id, action,
        actor_type, changed_by, actor_label, changes, context,
        user_actor:users!audit_events_changed_by_fkey(id, name, role)
      `,
      { count: 'exact' }
    )
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.entityId) query = query.eq('entity_id', filters.entityId)
  if (filters.entityIds) {
    // Empty list = no possible match. Force zero results without round-tripping.
    if (filters.entityIds.length === 0) return { events: [], total: 0 }
    query = query.in('entity_id', filters.entityIds)
  }
  if (filters.changedBy) query = query.eq('changed_by', filters.changedBy)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.actorType) query = query.eq('actor_type', filters.actorType)
  if (filters.startDate) query = query.gte('occurred_at', filters.startDate)
  if (filters.endDate) query = query.lt('occurred_at', filters.endDate)

  const { data, error, count } = await query
  if (error) {
    console.error('listAuditEvents error:', error)
    return { events: [], total: 0 }
  }

  const events = ((data as AuditEventRow[] | null) ?? []).map(rowToEvent)
  return { events, total: count ?? 0 }
}

export async function listAuditEventsForEntity(
  entityType: string,
  entityId: string,
  limit: number = 50
): Promise<AuditEventWithActor[]> {
  const { events } = await listAuditEvents({ entityType, entityId, limit })
  return events
}

/**
 * Resolve a work-order number to the matching pm_ticket / service_ticket UUIDs.
 * WO# is INTEGER and unique across both tables (shared `pm_tickets_wo_seq`),
 * but we query both for safety. Returns the entity_id strings to drop into
 * an audit_events.in('entity_id', ...) filter.
 */
export async function findTicketsByWorkOrder(wo: number): Promise<string[]> {
  if (!Number.isFinite(wo) || wo <= 0) return []
  const supabase = await createClient()
  const [pm, st] = await Promise.all([
    supabase.from('pm_tickets').select('id').eq('work_order_number', wo).limit(5),
    supabase.from('service_tickets').select('id').eq('work_order_number', wo).limit(5),
  ])
  const ids: string[] = []
  for (const row of pm.data ?? []) ids.push((row as { id: string }).id)
  for (const row of st.data ?? []) ids.push((row as { id: string }).id)
  return ids
}

const ACTOR_SCAN_LIMIT = 2000
const ACTOR_LIST_LIMIT = 200

// Scans the most recent ACTOR_SCAN_LIMIT events for distinct actors.
// `truncated` = true when either cap was hit, so the filter dropdown can say
// it may be missing actors who haven't acted recently.
export async function listAuditActors(): Promise<{
  actors: Array<{ id: string; name: string }>
  truncated: boolean
}> {
  const supabase = await createClient()
  const { data: ids, error: idsError } = await audit(supabase)
    .select('changed_by')
    .not('changed_by', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(ACTOR_SCAN_LIMIT)
  if (idsError) {
    console.error('listAuditActors ids error:', idsError)
    return { actors: [], truncated: false }
  }
  const rows = (ids as Array<{ changed_by: string | null }> | null) ?? []
  const unique = Array.from(
    new Set(
      rows.map((r) => r.changed_by).filter((v): v is string => !!v)
    )
  )
  const truncated = rows.length >= ACTOR_SCAN_LIMIT || unique.length > ACTOR_LIST_LIMIT
  if (unique.length === 0) return { actors: [], truncated }

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name')
    .in('id', unique.slice(0, ACTOR_LIST_LIMIT))
    .order('name')
  if (usersError) {
    console.error('listAuditActors users error:', usersError)
    return { actors: [], truncated }
  }
  return { actors: (users ?? []) as Array<{ id: string; name: string }>, truncated }
}
