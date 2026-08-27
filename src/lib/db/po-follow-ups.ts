import { createClient } from '@/lib/supabase/server'
import type { PoFollowUpMethod, PoFollowUpRow, PoFollowUpTicketType } from '@/types/database'

// Structured per-PO follow-up log — the office's PO-collection outreach on a
// completed PM or service ticket. Companion to the Billing Chase worklist.
// The log table is the source of truth for history; {service,pm}_tickets'
// po_last_contacted_at / po_last_method are denormalized copies of the newest
// entry for cheap worklist display, maintained here on each insert.
//
// Polymorphic across ticket type (migration 163, the credit_reviews (077)
// pattern): callers pass ticketType so this module can pick the right FK
// column on po_follow_ups and the right table for the denormalized stamp.

export type PoFollowUpWithAuthor = PoFollowUpRow & {
  contacted_by_user: { name: string } | null
}

const STAMP_TABLE: Record<PoFollowUpTicketType, 'service_tickets' | 'pm_tickets'> = {
  service: 'service_tickets',
  pm: 'pm_tickets',
}

export async function getPoFollowUps(
  ticketType: PoFollowUpTicketType,
  ticketId: string
): Promise<PoFollowUpWithAuthor[]> {
  const supabase = await createClient()
  const ticketColumn = ticketType === 'pm' ? 'pm_ticket_id' : 'service_ticket_id'

  const { data, error } = await supabase
    .from('po_follow_ups')
    .select('*, contacted_by_user:users!po_follow_ups_contacted_by_fkey ( name )')
    .eq(ticketColumn, ticketId)
    .order('contacted_at', { ascending: false })

  if (error) throw error
  return data as unknown as PoFollowUpWithAuthor[]
}

export async function createPoFollowUp(params: {
  ticketType: PoFollowUpTicketType
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
      ticket_type: params.ticketType,
      service_ticket_id: params.ticketType === 'service' ? params.ticketId : null,
      pm_ticket_id: params.ticketType === 'pm' ? params.ticketId : null,
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
    .from(STAMP_TABLE[params.ticketType])
    .update({ po_last_contacted_at: now, po_last_method: params.method })
    .eq('id', params.ticketId)

  if (stampError) {
    console.error('[po-follow-ups] recency stamp failed (contact was logged):', stampError)
  }

  return data as PoFollowUpRow
}
