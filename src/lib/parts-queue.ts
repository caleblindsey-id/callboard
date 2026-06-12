import type {
  PartRequest,
  PartsQueueSource,
  PartsValidationStatus,
  SynergyValidationStatus,
} from '@/types/database'

export type RevalidateResult = {
  synergy_validation_status: SynergyValidationStatus
  parts_validation_status: PartsValidationStatus
  synergy_validated_at: string | null
}

type UpdateArgs = {
  source: PartsQueueSource
  ticket_id: string
  part_index: number
  fields?: Partial<PartRequest>
  action?:
    | 'patch'
    | 'mark_ordered'
    | 'mark_received'
    | 'cancel'
    | 'reopen'
    | 'order'
    | 'pull_from_stock'
    | 'mark_pulled'
  reason?: string
  triage_reason?: string
}

async function postUpdate(args: UpdateArgs): Promise<PartRequest> {
  const res = await fetch('/api/parts-queue/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) {
    // Attach the HTTP status so callers can special-case a 409 optimistic-lock
    // conflict (retry once) without string-matching the message.
    const err = new Error(data.error || 'Failed to update part') as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data.part as PartRequest
}

export function updatePartFields(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
  fields: Partial<PartRequest>,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'patch', fields })
}

export function markPartOrdered(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
  fields?: Partial<PartRequest>,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'mark_ordered', fields })
}

export function markPartReceived(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'mark_received' })
}

// Marks a 'from_stock' part as physically pulled off the shelf and staged for
// the tech. Idempotent server-side if already pulled.
export function markPartPulled(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'mark_pulled' })
}

export function cancelPart(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
  reason: string,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'cancel', reason })
}

// Stock-vs-order triage of a 'pending_review' part. 'order' advances it into the
// To-Order queue (justification required when we have stock/PO on hand); 'stock'
// marks it pulled from the shelf (fulfilled in-house, no PO).
export function triagePart(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
  decision: 'order' | 'stock',
  triage_reason?: string,
): Promise<PartRequest> {
  return postUpdate({
    source,
    ticket_id,
    part_index,
    action: decision === 'order' ? 'order' : 'pull_from_stock',
    triage_reason,
  })
}

// Writes synergy_order_number on the parent service/PM ticket (not the
// parts_requested JSONB). Returns the persisted value so the client can sync
// every sibling row sharing this (source, ticket_id).
export async function setSynergyOrderNumber(
  source: PartsQueueSource,
  ticket_id: string,
  value: string | null,
): Promise<string | null> {
  const res = await fetch('/api/parts-queue/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source,
      ticket_id,
      // The route ignores part_index for this action, but the body shape
      // expects something present — send -1 to signal "not a part-level write".
      part_index: -1,
      action: 'set_synergy_order',
      synergy_order_number: value,
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.error || 'Failed to update Synergy order #') as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return (data.synergy_order_number ?? null) as string | null
}

// Reserved for a future "Cancelled" tab UI surface — the server route handles
// the action end-to-end already; only the trigger UI hasn't shipped.
export function reopenPart(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'reopen' })
}

export function ticketDeepLink(source: PartsQueueSource, ticket_id: string): string {
  return source === 'pm' ? `/tickets/${ticket_id}` : `/service/${ticket_id}`
}

// A re-check no longer runs synchronously: the route enqueues the request and
// the office workstation drains it (the hosted app has no Python/ODBC/LAN). We
// POST to enqueue, then poll until the queue row flips to done/error. On a long
// wait (workstation offline / busy) we resolve to 'queued' so the UI can show a
// soft "will re-check shortly" message instead of an error.
export type RevalidateOutcome =
  | { state: 'done'; result: RevalidateResult }
  | { state: 'queued' }

const REVALIDATE_POLL_INTERVAL_MS = 4_000
const REVALIDATE_POLL_TIMEOUT_MS = 180_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function revalidateTicket(
  source: PartsQueueSource,
  ticket_id: string,
): Promise<RevalidateOutcome> {
  const res = await fetch(`/api/parts-queue/${ticket_id}/revalidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to queue re-check')
  }
  const queueId: string | undefined = data.queue_id
  if (!queueId) {
    throw new Error('Re-check was not queued')
  }

  const deadline = Date.now() + REVALIDATE_POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(REVALIDATE_POLL_INTERVAL_MS)
    const pollRes = await fetch(
      `/api/parts-queue/${ticket_id}/revalidate?queue_id=${queueId}`,
    )
    if (!pollRes.ok) {
      // Auth failures are terminal; anything else (transient 404/5xx) keeps polling.
      if (pollRes.status === 401 || pollRes.status === 403) {
        const e = await pollRes.json().catch(() => ({}))
        throw new Error(e.error || 'Not authorized')
      }
      continue
    }
    const poll = await pollRes.json()
    if (poll.status === 'done') {
      return { state: 'done', result: poll.result as RevalidateResult }
    }
    if (poll.status === 'error') {
      const detail =
        poll.error || poll.result?.error || 'Re-check failed on the office workstation'
      throw new Error(`Re-check failed: ${detail}`)
    }
    // pending / processing → keep polling
  }
  return { state: 'queued' }
}
