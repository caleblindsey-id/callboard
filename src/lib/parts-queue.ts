import type { PartRequest, PartsQueueSource } from '@/types/database'

type UpdateArgs = {
  source: PartsQueueSource
  ticket_id: string
  part_index: number
  fields?: Partial<PartRequest>
  action?: 'patch' | 'mark_ordered' | 'mark_received' | 'cancel' | 'reopen'
  reason?: string
}

async function postUpdate(args: UpdateArgs): Promise<PartRequest> {
  const res = await fetch('/api/parts-queue/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error || 'Failed to update part')
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

export function cancelPart(
  source: PartsQueueSource,
  ticket_id: string,
  part_index: number,
  reason: string,
): Promise<PartRequest> {
  return postUpdate({ source, ticket_id, part_index, action: 'cancel', reason })
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
