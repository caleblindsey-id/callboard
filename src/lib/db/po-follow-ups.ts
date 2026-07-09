import { createClient } from '@/lib/supabase/server'
import type { PoFollowUpMethod, PoFollowUpRow } from '@/types/database'

// Structured per-PO follow-up log — the office's PO-collection outreach on a
// completed service ticket. Companion to the Waiting-on-PO worklist. The log
// table is the source of truth for history; service_tickets.po_last_contacted_at
// / po_last_method are denormalized copies of the newest entry for cheap
// worklist display, maintained here on each insert.

export type PoFollowUpWithAuthor = PoFollowUpRow & {
  contacted_by_user: { name: string } | null
}

export async function getPoFollowUps(ticketId: string): Promise<PoFollowUpWithAuthor[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('po_follow_ups')
    .select('*, contacted_by_user:users!po_follow_ups_contacted_by_fkey ( name )')
    .eq('ticket_id', ticketId)
    .order('contacted_at', { ascending: false })

  if (error) throw error
  return data as unknown as PoFollowUpWithAuthor[]
}

export async function createPoFollowUp(params: {
  ticketId: string
  userId: string
  method: PoFollowUpMethod
  note: string | null
}): Promise<PoFollowUpRow> {
  const supabase = await createClient()
  // Same timestamp on the log row and the denormalized stamp so the worklist's
  // "days since" matches the newest logged attempt exactly.
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('po_follow_ups')
    .insert({
      ticket_id: params.ticketId,
      method: params.method,
      note: params.note,
      contacted_by: params.userId,
      contacted_at: now,
    })
    .select()
    .single()

  if (error) throw error

  // Denormalized recency stamps for the worklist row (best-effort — the log row
  // above is the record of truth; a failed stamp shouldn't discard the logged
  // contact, so surface it but don't roll back).
  const { error: stampError } = await supabase
    .from('service_tickets')
    .update({ po_last_contacted_at: now, po_last_method: params.method })
    .eq('id', params.ticketId)

  if (stampError) {
    console.error('[po-follow-ups] recency stamp failed (contact was logged):', stampError)
  }

  return data as PoFollowUpRow
}
