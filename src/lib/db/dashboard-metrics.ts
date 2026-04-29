import { createClient } from '@/lib/supabase/server'
import type { TicketStatus } from '@/types/database'
import type { ServiceTicketStatus } from '@/types/service-tickets'

// --- Types --------------------------------------------------------------

export type OpenWorkCounts = { pm: number; service: number; total: number }
export type MoneyAtRiskCounts = { creditHold: number; overdue: number; total: number }
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

// --- KPI: Money at Risk -------------------------------------------------
// Count of customers on credit hold + count of overdue PMs. Both signal
// revenue exposure even when we don't have AR balance loaded.

export async function getMoneyAtRiskCounts(): Promise<MoneyAtRiskCounts> {
  const supabase = await createClient()

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [creditHoldRes, overdueRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('credit_hold', true),
    supabase
      .from('pm_tickets')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .lt('scheduled_date', monthStart)
      .not('status', 'in', '("completed","billed","skipped")'),
  ])

  if (creditHoldRes.error) throw creditHoldRes.error
  if (overdueRes.error) throw overdueRes.error

  const creditHold = creditHoldRes.count ?? 0
  const overdue = overdueRes.count ?? 0
  return { creditHold, overdue, total: creditHold + overdue }
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

// --- KPI: Parts Blocked --------------------------------------------------
// Count of tickets currently blocked on parts (requested or ordered, not
// yet received). Sums PM + Service since "blocked on parts" is the same
// operational state regardless of ticket type.

export async function getPartsBlockedCount(technicianId?: string): Promise<number> {
  const supabase = await createClient()

  let pmQ = supabase
    .from('pm_tickets')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or(
      `parts_requested.cs.${JSON.stringify([{ status: 'requested' }])},parts_requested.cs.${JSON.stringify([{ status: 'ordered' }])}`
    )
    .not('status', 'in', '("completed","billed","skipped","skip_requested")')
  let svcQ = supabase
    .from('service_tickets')
    .select('id', { count: 'exact', head: true })
    .or(
      `parts_requested.cs.${JSON.stringify([{ status: 'requested' }])},parts_requested.cs.${JSON.stringify([{ status: 'ordered' }])}`
    )
    .not('status', 'in', '("billed","declined","canceled")')

  if (technicianId) {
    pmQ = pmQ.eq('assigned_technician_id', technicianId)
    svcQ = svcQ.eq('assigned_technician_id', technicianId)
  }

  const [pmRes, svcRes] = await Promise.all([pmQ, svcQ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  return (pmRes.count ?? 0) + (svcRes.count ?? 0)
}

// --- KPI: MTD Revenue (all ticket types) --------------------------------

export async function getMtdRevenue(technicianId?: string): Promise<MtdRevenue> {
  const supabase = await createClient()
  const { start, end } = currentMonthRange()

  let pmQ = supabase
    .from('pm_tickets')
    .select('billing_amount')
    .is('deleted_at', null)
    .in('status', ['completed', 'billed'])
    .gte('completed_at', start)
    .lt('completed_at', end)
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
  const { count, error } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('credit_hold', true)
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
