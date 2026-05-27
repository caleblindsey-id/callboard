import { createClient } from '@/lib/supabase/server'
import type { CreditReviewStatus } from '@/types/database'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export interface CreditReviewQueueItem {
  id: string
  status: CreditReviewStatus
  ticketType: 'pm' | 'service'
  createdAt: string
  emailedAt: string | null
  blockReason: string | null
  decidedByName: string | null
  customerId: number
  customerName: string
  accountNumber: string | null
  orderLabel: string
  amountLabel: string
  ticketHref: string | null
}

function first<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// Open (pending/blocked) credit reviews for the manager queue, oldest first.
export async function getOpenCreditReviews(): Promise<CreditReviewQueueItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('credit_reviews')
    .select(`
      id, status, ticket_type, created_at, emailed_at, block_reason, decided_by_name, customer_id,
      customers ( name, account_number ),
      pm_tickets ( id, month, year, equipment ( make, model ) ),
      service_tickets ( id, work_order_number, problem_description, estimate_amount )
    `)
    .in('status', ['pending', 'blocked'])
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((r): CreditReviewQueueItem => {
    const customer = first(r.customers as { name: string; account_number: string | null } | { name: string; account_number: string | null }[])
    let orderLabel = 'Order'
    let amountLabel = '—'
    let ticketHref: string | null = null

    if (r.ticket_type === 'pm') {
      const pm = first(r.pm_tickets as { id: string; month: number; year: number; equipment: unknown } | { id: string; month: number; year: number; equipment: unknown }[])
      const equip = first(pm?.equipment as { make: string | null; model: string | null } | null)
      const monthLabel = pm ? `${MONTHS[(pm.month - 1) % 12] ?? ''} ${pm.year}`.trim() : ''
      const equipLabel = equip ? [equip.make, equip.model].filter(Boolean).join(' ') : ''
      orderLabel = `PM ${monthLabel}${equipLabel ? ` — ${equipLabel}` : ''}`.trim()
      amountLabel = 'Per contract'
      ticketHref = pm ? `/tickets/${pm.id}` : null
    } else {
      const svc = first(r.service_tickets as { id: string; work_order_number: number | null; problem_description: string | null; estimate_amount: number | null } | { id: string; work_order_number: number | null; problem_description: string | null; estimate_amount: number | null }[])
      orderLabel = svc?.work_order_number ? `Service WO-${svc.work_order_number}` : 'Service order'
      amountLabel = svc?.estimate_amount != null ? `$${svc.estimate_amount.toFixed(2)}` : 'TBD'
      ticketHref = svc ? `/service/${svc.id}` : null
    }

    return {
      id: r.id,
      status: r.status as CreditReviewStatus,
      ticketType: r.ticket_type as 'pm' | 'service',
      createdAt: r.created_at,
      emailedAt: r.emailed_at,
      blockReason: r.block_reason,
      decidedByName: r.decided_by_name,
      customerId: r.customer_id,
      customerName: customer?.name ?? 'Unknown',
      accountNumber: customer?.account_number ?? null,
      orderLabel,
      amountLabel,
      ticketHref,
    }
  })
}

export async function getCreditReviewCounts(): Promise<{ pending: number; blocked: number }> {
  const supabase = await createClient()
  const [{ count: pending }, { count: blocked }] = await Promise.all([
    supabase.from('credit_reviews').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('credit_reviews').select('id', { count: 'exact', head: true }).eq('status', 'blocked'),
  ])
  return { pending: pending ?? 0, blocked: blocked ?? 0 }
}
