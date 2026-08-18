import { createClient } from '@/lib/supabase/server'
import type { PmQuoteRow, PmQuoteLineRow, PmQuoteStatus } from '@/types/database'

// ============================================================
// PM quote reads (migration 159).
//
// Writes live in the API routes so role checks and the one-customer /
// flat-rate-only validation stay on the server boundary next to the request.
// ============================================================

export interface PmQuoteWithJoins extends PmQuoteRow {
  customers: {
    id: number
    name: string
    account_number: string | null
    po_required: boolean | null
    pm_quote_required: boolean
  } | null
  pm_quote_lines: PmQuoteLineRow[]
  created_by: { name: string | null } | null
}

const QUOTE_SELECT = `
  *,
  customers(id, name, account_number, po_required, pm_quote_required),
  pm_quote_lines(*),
  created_by:users!pm_quotes_created_by_id_fkey(name)
`

export async function getQuote(id: string): Promise<PmQuoteWithJoins | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pm_quotes')
    .select(QUOTE_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return null
  return sortLines(data as unknown as PmQuoteWithJoins)
}

export async function listQuotes(
  filters: { status?: PmQuoteStatus; customerId?: number } = {}
): Promise<PmQuoteWithJoins[]> {
  const supabase = await createClient()
  let query = supabase
    .from('pm_quotes')
    .select(QUOTE_SELECT)
    .is('deleted_at', null)
    .order('quote_number', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.customerId) query = query.eq('customer_id', filters.customerId)

  const { data, error } = await query
  if (error) {
    console.error('[pm-quotes] listQuotes error:', error)
    return []
  }
  return (data as unknown as PmQuoteWithJoins[]).map(sortLines)
}

/**
 * Ticket ids covered by an accepted, non-deleted quote.
 *
 * Batched on purpose: the ticket board and the start-work gate both need this
 * for a whole page of tickets, and a per-ticket lookup would be an N+1 on the
 * hottest screen in the app.
 */
export async function getAcceptedQuoteTicketIds(ticketIds: string[]): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pm_quote_lines')
    .select('pm_ticket_id, pm_quotes!inner(status, deleted_at)')
    .in('pm_ticket_id', ticketIds)
    .eq('pm_quotes.status', 'accepted')
    .is('pm_quotes.deleted_at', null)

  if (error) {
    console.error('[pm-quotes] getAcceptedQuoteTicketIds error:', error)
    return new Set()
  }
  return new Set((data ?? []).map((r) => (r as { pm_ticket_id: string }).pm_ticket_id))
}

/**
 * The quote a ticket is waiting on, if any. Used to point the ticket-detail
 * banner at something actionable instead of a dead end.
 */
export async function getLatestQuoteForTicket(
  ticketId: string
): Promise<{ id: string; quote_number: number; status: PmQuoteStatus } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pm_quote_lines')
    .select('pm_quotes!inner(id, quote_number, status, deleted_at, created_at)')
    .eq('pm_ticket_id', ticketId)
    .is('pm_quotes.deleted_at', null)
    .order('created_at', { ascending: false, referencedTable: 'pm_quotes' })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const quote = (data[0] as unknown as { pm_quotes: { id: string; quote_number: number; status: PmQuoteStatus } })
    .pm_quotes
  return quote ? { id: quote.id, quote_number: quote.quote_number, status: quote.status } : null
}

function sortLines(quote: PmQuoteWithJoins): PmQuoteWithJoins {
  quote.pm_quote_lines = [...(quote.pm_quote_lines ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order || (a.work_order_number ?? 0) - (b.work_order_number ?? 0)
  )
  return quote
}

export interface QuoteGateResult {
  /** Quote the office should chase, when one already exists. */
  quoteNumber: number | null
  quoteId: string | null
  message: string
}

/**
 * Is this PM ticket blocked from starting because its customer requires an
 * accepted quote and does not have one?
 *
 * Returns null when work may proceed. Enforced in BOTH
 * PATCH /api/tickets/[id] (the assigned -> in_progress edge) and
 * POST /api/tickets/[id]/complete, because the completion route does not
 * require in_progress first: it only rejects an already-billed ticket, so a
 * tech can complete straight from assigned and never touch in_progress at all.
 * Guarding only the PATCH would leave that path wide open.
 */
export async function isTicketQuoteGated(ticketId: string): Promise<QuoteGateResult | null> {
  const supabase = await createClient()

  const { data: ticket } = await supabase
    .from('pm_tickets')
    .select('id, work_order_number, customers(name, pm_quote_required)')
    .eq('id', ticketId)
    .single()

  const customer = (ticket as { customers?: { name: string; pm_quote_required: boolean } | null } | null)
    ?.customers
  if (!customer?.pm_quote_required) return null

  const { data: lines } = await supabase
    .from('pm_quote_lines')
    .select('pm_quotes!inner(id, quote_number, status, deleted_at)')
    .eq('pm_ticket_id', ticketId)
    .is('pm_quotes.deleted_at', null)

  const quotes = ((lines ?? []) as unknown as Array<{
    pm_quotes: { id: string; quote_number: number; status: string } | null
  }>)
    .map((r) => r.pm_quotes)
    .filter((q): q is { id: string; quote_number: number; status: string } => !!q)

  if (quotes.some((q) => q.status === 'accepted')) return null

  // Point at the most recent live quote so the message is actionable rather
  // than just a refusal.
  const pending =
    quotes.find((q) => q.status === 'sent') ??
    quotes.find((q) => q.status === 'draft') ??
    quotes[0] ??
    null

  return {
    quoteId: pending?.id ?? null,
    quoteNumber: pending?.quote_number ?? null,
    message: pending
      ? `${customer.name} requires an accepted quote before work starts. Quote Q-${pending.quote_number} is ${pending.status}, not accepted yet.`
      : `${customer.name} requires an accepted quote before work starts, and no quote has been built for this work order yet.`,
  }
}
