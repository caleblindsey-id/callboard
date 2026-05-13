import { createClient } from '@/lib/supabase/server'
import type { TicketStatus } from '@/types/database'
import type { ServiceTicketStatus } from '@/types/service-tickets'

// --- Types --------------------------------------------------------------

export type OpenWorkCounts = { pm: number; service: number; total: number }
export type PendingApproval = { count: number; amount: number }
export type MtdRevenue = { pm: number; service: number; total: number }
export type EstimatesPipeline = {
  sent: { count: number; amount: number }
  approvedThisMonth: { count: number; amount: number }
}
export type TechLeadsPipeline = {
  pending: number
  approved: number
  matchPending: number
  activeValue: number
}
export type TechLeadBonusRow = {
  techId: string
  techName: string
  amount: number
}

// --- Date helpers -------------------------------------------------------

function currentMonthRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  return { start, end }
}

// --- KPI: Open Work -----------------------------------------------------
// Counts tickets in actively-worked statuses across PM and Service.
// Excludes terminal states (completed/billed/skipped/declined/canceled).

const OPEN_PM_STATUSES: TicketStatus[] = ['unassigned', 'assigned', 'in_progress']
const OPEN_SERVICE_STATUSES: ServiceTicketStatus[] = ['open', 'estimated', 'approved', 'in_progress']

export async function getOpenWorkCounts(technicianId?: string): Promise<OpenWorkCounts> {
  const supabase = await createClient()

  let pmQ = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .in('status', OPEN_PM_STATUSES)
  let svcQ = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .in('status', OPEN_SERVICE_STATUSES)

  if (technicianId) {
    pmQ = pmQ.eq('assigned_technician_id', technicianId)
    svcQ = svcQ.eq('assigned_technician_id', technicianId)
  }

  const [pmRes, svcRes] = await Promise.all([pmQ, svcQ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const pm = pmRes.count ?? 0
  const service = svcRes.count ?? 0
  return { pm, service, total: pm + service }
}

// --- KPI: Pending Approval ($ + count) ----------------------------------
// Service tickets in 'estimated' status — sent to customer, awaiting signature.

export async function getPendingApproval(): Promise<PendingApproval> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .select('estimate_amount')
    .eq('status', 'estimated')

  if (error) throw error

  const rows = (data ?? []) as { estimate_amount: number | null }[]
  const amount = rows.reduce((sum, r) => sum + (r.estimate_amount ?? 0), 0)
  return { count: rows.length, amount }
}

// --- KPI: MTD Revenue (all ticket types) --------------------------------
// pm_tickets uses `completed_date` (DATE), service_tickets uses
// `completed_at` (TIMESTAMPTZ) — different column types and names.

export async function getMtdRevenue(technicianId?: string): Promise<MtdRevenue> {
  const supabase = await createClient()
  const { start, end } = currentMonthRange()
  const now = new Date()
  const monthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const nextMonthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)

  let pmQ = supabase
    .from('pm_tickets')
    .select('billing_amount')
    .is('deleted_at', null)
    .in('status', ['completed', 'billed'])
    .gte('completed_date', monthFirst)
    .lt('completed_date', nextMonthFirst)
  let svcQ = supabase
    .from('service_tickets')
    .select('billing_amount')
    .in('status', ['completed', 'billed'])
    .gte('completed_at', start)
    .lt('completed_at', end)

  if (technicianId) {
    pmQ = pmQ.eq('assigned_technician_id', technicianId)
    svcQ = svcQ.eq('assigned_technician_id', technicianId)
  }

  const [pmRes, svcRes] = await Promise.all([pmQ, svcQ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const pmRows = (pmRes.data ?? []) as { billing_amount: number | null }[]
  const svcRows = (svcRes.data ?? []) as { billing_amount: number | null }[]
  const pm = pmRows.reduce((s, r) => s + (r.billing_amount ?? 0), 0)
  const service = svcRows.reduce((s, r) => s + (r.billing_amount ?? 0), 0)
  return { pm, service, total: pm + service }
}

// --- Alert: Credit Hold count -------------------------------------------

export async function getCreditHoldCount(): Promise<number> {
  const supabase = await createClient()

  const [pmRes, svcRes] = await Promise.all([
    supabase
      .from('pm_tickets')
      .select('customer_id')
      .is('deleted_at', null)
      .in('status', OPEN_PM_STATUSES),
    supabase
      .from('service_tickets')
      .select('customer_id')
      .in('status', OPEN_SERVICE_STATUSES),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const activeCustomerIds = new Set<number>()
  for (const r of (pmRes.data ?? []) as { customer_id: number | null }[]) {
    if (r.customer_id != null) activeCustomerIds.add(r.customer_id)
  }
  for (const r of (svcRes.data ?? []) as { customer_id: number }[]) activeCustomerIds.add(r.customer_id)

  if (activeCustomerIds.size === 0) return 0

  const { count, error } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('credit_hold', true)
    .in('id', Array.from(activeCustomerIds))
  if (error) throw error
  return count ?? 0
}

// --- Alert: Stale Estimates ---------------------------------------------
// Service tickets in 'estimated' status older than threshold (default 14 days).

export async function getStaleEstimatesCount(daysThreshold = 14): Promise<number> {
  const supabase = await createClient()
  const cutoff = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'estimated')
    .lt('created_at', cutoff)

  if (error) throw error
  return count ?? 0
}

// --- Pipeline & Money: Estimates Pipeline -------------------------------

export async function getEstimatesPipeline(): Promise<EstimatesPipeline> {
  const supabase = await createClient()
  const { start, end } = currentMonthRange()

  const [sentRes, approvedRes] = await Promise.all([
    supabase
      .from('service_tickets')
      .select('estimate_amount')
      .eq('status', 'estimated'),
    supabase
      .from('service_tickets')
      .select('estimate_amount')
      .in('status', ['approved', 'in_progress', 'completed', 'billed'])
      .gte('estimate_approved_at', start)
      .lt('estimate_approved_at', end),
  ])

  if (sentRes.error) throw sentRes.error
  if (approvedRes.error) throw approvedRes.error

  const sentRows = (sentRes.data ?? []) as { estimate_amount: number | null }[]
  const apprRows = (approvedRes.data ?? []) as { estimate_amount: number | null }[]

  return {
    sent: {
      count: sentRows.length,
      amount: sentRows.reduce((s, r) => s + (r.estimate_amount ?? 0), 0),
    },
    approvedThisMonth: {
      count: apprRows.length,
      amount: apprRows.reduce((s, r) => s + (r.estimate_amount ?? 0), 0),
    },
  }
}

// --- Pipeline & Money: Tech Leads ---------------------------------------

export async function getTechLeadsPipeline(): Promise<TechLeadsPipeline> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tech_leads')
    .select('status, bonus_amount')
    .in('status', ['pending', 'approved', 'match_pending'])

  if (error) throw error

  const rows = (data ?? []) as { status: string; bonus_amount: number | null }[]

  let pending = 0
  let approved = 0
  let matchPending = 0
  let activeValue = 0
  for (const r of rows) {
    if (r.status === 'pending') pending++
    else if (r.status === 'approved') approved++
    else if (r.status === 'match_pending') matchPending++
    activeValue += r.bonus_amount ?? 0
  }
  return { pending, approved, matchPending, activeValue }
}

// --- Pipeline & Money: Tech Lead Bonus MTD ------------------------------
// Sums bonus_amount per technician for leads earned/paid in current month.

export async function getTechLeadBonusLeaderboard(limit = 5): Promise<TechLeadBonusRow[]> {
  const supabase = await createClient()
  const { start, end } = currentMonthRange()

  const { data, error } = await supabase
    .from('tech_leads')
    .select('bonus_amount, submitted_by, submitter:users!tech_leads_submitted_by_fkey(id, name)')
    .in('status', ['earned', 'paid'])
    .gte('earned_at', start)
    .lt('earned_at', end)

  if (error) throw error

  const rows = (data ?? []) as {
    bonus_amount: number | null
    submitted_by: string
    submitter: { id: string; name: string } | null
  }[]

  const byTech = new Map<string, TechLeadBonusRow>()
  for (const r of rows) {
    const name = r.submitter?.name ?? 'Unknown'
    const existing = byTech.get(r.submitted_by)
    if (existing) {
      existing.amount += r.bonus_amount ?? 0
    } else {
      byTech.set(r.submitted_by, {
        techId: r.submitted_by,
        techName: name,
        amount: r.bonus_amount ?? 0,
      })
    }
  }

  return Array.from(byTech.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

// --- Alert: Pending Payout Approvals ------------------------------------
// Combined count of pending tech_leads and pending ace_labor_entries. Drives
// the dashboard "Tech Payouts" alert; both flows resolve on /tech-payouts.

export async function getPendingPayoutApprovalsCount(): Promise<number> {
  const supabase = await createClient()

  const [leadsRes, aceRes] = await Promise.all([
    supabase
      .from('tech_leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('ace_labor_entries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])
  if (leadsRes.error) throw leadsRes.error
  if (aceRes.error) throw aceRes.error
  return (leadsRes.count ?? 0) + (aceRes.count ?? 0)
}

