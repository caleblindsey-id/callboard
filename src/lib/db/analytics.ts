import { createClient } from '@/lib/supabase/server'
import { TechnicianTargetRow, PartUsed, UserRole } from '@/types/database'
import { getSetting } from '@/lib/db/settings'

// ============================================================
// Role-aware response shaping
// ============================================================
//
// Coordinators are part of MANAGER_ROLES (they need access to most analytics
// for visibility) but should NOT see compensation-derived fields. Profit and
// laborCost can be back-calculated to per-tech hourly_cost when revenue + hours
// are also visible. These helpers strip those fields from the API response
// before it leaves the server. Pages that bypass the API (SSR) call them too.

type TeamPayloadShape = {
  techRows?: Array<Record<string, unknown>>
  current?: Record<string, unknown>
  [k: string]: unknown
}

export function stripCostFieldsForCoordinator<T extends TeamPayloadShape>(payload: T, role: UserRole): T {
  if (role !== 'coordinator') return payload
  const next: T = JSON.parse(JSON.stringify(payload))
  if (Array.isArray(next.techRows)) {
    for (const row of next.techRows) {
      row.hourlyCost = null
      row.laborCost = null
      row.grossProfit = null
    }
  }
  if (next.current && typeof next.current === 'object') {
    ;(next.current as Record<string, unknown>).grossProfit = null
    ;(next.current as Record<string, unknown>).teamGrossProfit = null
  }
  return next
}

type TechPayloadShape = {
  tech?: { hourlyCost?: number | null; [k: string]: unknown }
  current?: Record<string, unknown>
  prior?: Record<string, unknown>
  yoy?: Record<string, unknown> | null
  recentTickets?: Array<Record<string, unknown>>
  trend?: Array<Record<string, unknown>>
  [k: string]: unknown
}

export function stripTechCostFieldsForCoordinator<T extends TechPayloadShape>(payload: T, role: UserRole): T {
  if (role !== 'coordinator') return payload
  const next: T = JSON.parse(JSON.stringify(payload))
  if (next.tech) next.tech.hourlyCost = null
  for (const k of ['current', 'prior', 'yoy'] as const) {
    const slot = next[k]
    if (slot && typeof slot === 'object') {
      ;(slot as Record<string, unknown>).laborCost = null
      ;(slot as Record<string, unknown>).grossProfit = null
    }
  }
  if (Array.isArray(next.recentTickets)) {
    for (const t of next.recentTickets) t.profit = null
  }
  if (Array.isArray(next.trend)) {
    for (const t of next.trend) t.profit = null
  }
  return next
}

// ============================================================
// Types
// ============================================================

export type TechRow = {
  id: string
  name: string
  hourlyCost: number | null
  ticketsCompleted: number
  revenue: number
  totalHours: number
  laborCost: number | null
  grossProfit: number | null
  revenuePerHour: number | null
  avgCompletionDays: number | null
  completionRate: number
  additionalWorkRate: number
  targets: ResolvedTarget[]
}

export type ResolvedTarget = {
  metric: string
  targetValue: number
  periodType: string
}

export type TeamAnalytics = {
  period: { type: 'weekly' | 'monthly'; startDate: string; endDate: string; label: string }
  teamKpis: {
    ticketsCompleted: number
    totalRevenue: number
    grossProfit: number | null
    avgHoursPerTicket: number | null
    avgCompletionDays: number | null
  }
  priorKpis: {
    ticketsCompleted: number
    totalRevenue: number
    grossProfit: number | null
    avgHoursPerTicket: number | null
    avgCompletionDays: number | null
  }
  techRows: TechRow[]
  teamTrend: TrendPoint[]
}

export type TrendPoint = {
  month: number
  year: number
  label: string
  ticketsCompleted: number
  revenue: number
  totalHours: number
  grossProfit: number | null
}

export type RevenueBreakdownData = {
  flatRate: number
  additionalLabor: number
  additionalParts: number
  additionalWorkRate: number
}

export type TechnicianAnalytics = {
  tech: { id: string; name: string; hourlyCost: number | null }
  period: { type: 'weekly' | 'monthly'; startDate: string; endDate: string; label: string }
  current: TechRow
  prior: TechRow
  yoy: TechRow | null
  trend: TrendPoint[]
  revenueBreakdown: RevenueBreakdownData
  recentTickets: RecentTicket[]
  targets: ResolvedTarget[]
}

export type RecentTicket = {
  id: string
  workOrderNumber: number
  customerName: string | null
  completedDate: string | null
  hoursWorked: number | null
  additionalHoursWorked: number | null
  billingAmount: number | null
  status: string
  laborCost: number | null
}

// ============================================================
// Helpers
// ============================================================

function getMonthRange(date: string): { start: string; end: string; label: string } {
  const d = new Date(date + 'T12:00:00Z')
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1)).toISOString().split('T')[0]
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().split('T')[0]
  const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return { start, end, label }
}

function getWeekRange(date: string): { start: string; end: string; label: string } {
  const d = new Date(date + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day // Monday = start
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() + diff)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const start = monday.toISOString().split('T')[0]
  const end = sunday.toISOString().split('T')[0]
  const label = `Week of ${monday.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${sunday.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
  return { start, end, label }
}

function getPriorRange(periodType: 'weekly' | 'monthly', start: string): { start: string; end: string; label: string } {
  if (periodType === 'monthly') {
    const d = new Date(start + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() - 1)
    return getMonthRange(d.toISOString().split('T')[0])
  }
  const d = new Date(start + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 7)
  return getWeekRange(d.toISOString().split('T')[0])
}

function getYoyRange(start: string): { start: string; end: string; label: string } {
  const d = new Date(start + 'T12:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() - 1)
  return getMonthRange(d.toISOString().split('T')[0])
}

type RawTicket = {
  assigned_technician_id: string | null
  status: string
  billing_amount: number | null
  hours_worked: number | null
  additional_hours_worked: number | null
  additional_parts_used: PartUsed[] | null
  completed_date: string | null
  scheduled_date: string | null
}

function aggregateTechMetrics(
  tickets: RawTicket[],
  techId: string,
  hourlyCost: number | null
): Omit<TechRow, 'id' | 'name' | 'hourlyCost' | 'targets'> {
  const techTickets = tickets.filter((t) => t.assigned_technician_id === techId)
  const completed = techTickets.filter((t) => t.status === 'completed' || t.status === 'billed')
  const allActive = techTickets.filter((t) => ['completed', 'billed', 'assigned', 'in_progress', 'skipped'].includes(t.status))

  const ticketsCompleted = completed.length
  const revenue = completed.reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)
  const totalHours = completed.reduce(
    (sum, t) => sum + (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0),
    0
  )
  // Round cost-derived values to cents — matches the .toFixed(2) UI display
  // and avoids sub-cent IEEE 754 drift between accumulated totals.
  const laborCost = hourlyCost != null ? Math.round(totalHours * hourlyCost * 100) / 100 : null
  const grossProfit = laborCost != null ? Math.round((revenue - laborCost) * 100) / 100 : null
  const revenuePerHour = totalHours > 0 ? revenue / totalHours : null

  // Avg completion days
  let totalDays = 0
  let countWithDates = 0
  for (const t of completed) {
    if (t.completed_date && t.scheduled_date) {
      const diff = (new Date(t.completed_date).getTime() - new Date(t.scheduled_date).getTime()) / (1000 * 60 * 60 * 24)
      totalDays += diff
      countWithDates++
    }
  }
  const avgCompletionDays = countWithDates > 0 ? totalDays / countWithDates : null

  const completionRate = allActive.length > 0 ? ticketsCompleted / allActive.length : 0
  const withAdditional = completed.filter((t) => (t.additional_hours_worked ?? 0) > 0).length
  const additionalWorkRate = ticketsCompleted > 0 ? withAdditional / ticketsCompleted : 0

  return {
    ticketsCompleted,
    revenue,
    totalHours,
    laborCost,
    grossProfit,
    revenuePerHour,
    avgCompletionDays,
    completionRate,
    additionalWorkRate,
  }
}

function emptyMetrics(): Omit<TechRow, 'id' | 'name' | 'hourlyCost' | 'targets'> {
  return {
    ticketsCompleted: 0,
    revenue: 0,
    totalHours: 0,
    laborCost: null,
    grossProfit: null,
    revenuePerHour: null,
    avgCompletionDays: null,
    completionRate: 0,
    additionalWorkRate: 0,
  }
}

// ============================================================
// getTeamAnalytics
// ============================================================

export async function getTeamAnalytics(
  periodType: 'weekly' | 'monthly',
  date: string
): Promise<TeamAnalytics> {
  const supabase = await createClient()

  const range = periodType === 'monthly' ? getMonthRange(date) : getWeekRange(date)
  const priorRange = getPriorRange(periodType, range.start)

  // Fetch technicians first — downstream resolveTargets and tech-row build depend on this list.
  const { data: techs, error: techErr } = await supabase
    .from('users')
    .select('id, name, hourly_cost')
    .eq('role', 'technician')
    .eq('active', true)
    .order('name')

  if (techErr) throw techErr

  // Trend window (last 12 months) — computed up here so the trend query can run
  // in the same parallel batch as current/prior/allStatus/targets below.
  const trendStart = new Date(range.start + 'T12:00:00Z')
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 11)
  const trendStartStr = trendStart.toISOString().split('T')[0]
  const curDate = new Date(range.start + 'T12:00:00Z')

  // All five remaining fetches are independent of each other — run in parallel.
  const [
    currentRes,
    priorRes,
    allStatusRes,
    targetsRes,
    trendRes,
  ] = await Promise.all([
    supabase
      .from('pm_tickets')
      .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date')
      .is('deleted_at', null)
      .gte('completed_date', range.start)
      .lte('completed_date', range.end + 'T23:59:59Z'),
    supabase
      .from('pm_tickets')
      .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date')
      .is('deleted_at', null)
      .gte('completed_date', priorRange.start)
      .lte('completed_date', priorRange.end + 'T23:59:59Z'),
    // AN-25: completion-rate denominator query.
    //
    // Monthly view: anchor on the pm_tickets.month/year columns — those are
    // populated for every ticket and define the scheduled month explicitly.
    //
    // Weekly view: the month/year filter wrongly pulls every ticket in the
    // calendar month, so a tech with 60 monthly tickets but only 5 due this
    // week looked like 5/60 instead of 5/eligible-this-week. The correct
    // denominator is tickets that were eligible to be completed in the week —
    // scheduled on or before the week's end AND not already completed before
    // the week began. We filter further in-memory after the fetch.
    (periodType === 'weekly'
      ? supabase
          .from('pm_tickets')
          .select('assigned_technician_id, status, scheduled_date, completed_date')
          .is('deleted_at', null)
          .lte('scheduled_date', range.end)
          .or(`completed_date.is.null,completed_date.gte.${range.start}`)
      : supabase
          .from('pm_tickets')
          .select('assigned_technician_id, status, scheduled_date, completed_date')
          .is('deleted_at', null)
          .eq('month', curDate.getUTCMonth() + 1)
          .eq('year', curDate.getUTCFullYear())),
    supabase
      .from('technician_targets')
      .select('*')
      .eq('active', true)
      .eq('period_type', periodType)
      .lte('effective_from', date)
      .order('effective_from', { ascending: false }),
    supabase
      .from('pm_tickets')
      .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, completed_date')
      .is('deleted_at', null)
      .in('status', ['completed', 'billed'])
      .gte('completed_date', trendStartStr)
      .order('completed_date', { ascending: false }),
  ])

  if (currentRes.error) throw currentRes.error
  if (priorRes.error) throw priorRes.error
  // allStatusRes / targetsRes / trendRes preserve the original behavior of swallowing errors silently.

  const currentTickets = currentRes.data
  const priorTickets = priorRes.data
  const allStatusTickets = allStatusRes.data
  const targets = targetsRes.data
  const trendTickets = trendRes.data

  // Merge completed tickets with all-status tickets for completion rate calculation
  const mergedCurrent = [
    ...(currentTickets ?? []),
    ...(allStatusTickets ?? []).filter(
      (t) => !['completed', 'billed'].includes(t.status)
    ).map((t) => ({ ...t, billing_amount: null, hours_worked: null, additional_hours_worked: null, additional_parts_used: null, completed_date: null, scheduled_date: null })),
  ] as RawTicket[]

  const targetMap = new Map<string, Map<string, TechnicianTargetRow>>()
  const teamDefaults = new Map<string, TechnicianTargetRow>()
  for (const t of targets ?? []) {
    if (t.technician_id === null) {
      if (!teamDefaults.has(t.metric)) teamDefaults.set(t.metric, t as TechnicianTargetRow)
    } else {
      if (!targetMap.has(t.technician_id)) targetMap.set(t.technician_id, new Map())
      const techTargets = targetMap.get(t.technician_id)!
      if (!techTargets.has(t.metric)) techTargets.set(t.metric, t as TechnicianTargetRow)
    }
  }

  function resolveTargets(techId: string): ResolvedTarget[] {
    const result: ResolvedTarget[] = []
    const metrics = ['tickets_completed', 'revenue', 'avg_completion_days', 'revenue_per_hour']
    for (const metric of metrics) {
      const individual = targetMap.get(techId)?.get(metric)
      const team = teamDefaults.get(metric)
      const target = individual ?? team
      if (target) {
        result.push({ metric: target.metric, targetValue: target.target_value, periodType: target.period_type })
      }
    }
    return result
  }

  // Build tech rows
  const techRows: TechRow[] = (techs ?? []).map((tech) => {
    const metrics = aggregateTechMetrics(mergedCurrent, tech.id, tech.hourly_cost)
    return {
      id: tech.id,
      name: tech.name,
      hourlyCost: tech.hourly_cost,
      ...metrics,
      targets: resolveTargets(tech.id),
    }
  })

  // Team-wide KPIs
  const teamTickets = techRows.reduce((s, r) => s + r.ticketsCompleted, 0)
  const teamRevenue = techRows.reduce((s, r) => s + r.revenue, 0)
  const teamHours = techRows.reduce((s, r) => s + r.totalHours, 0)
  const techsWithCost = techRows.filter((r) => r.grossProfit != null)
  const teamGrossProfit = techsWithCost.length > 0 ? techsWithCost.reduce((s, r) => s + r.grossProfit!, 0) : null

  // Prior period aggregation
  const priorAll = (priorTickets ?? []) as RawTicket[]
  const priorCompleted = priorAll.filter((t) => t.status === 'completed' || t.status === 'billed')
  const priorTicketCount = priorCompleted.length
  const priorRevenue = priorCompleted.reduce((s, t) => s + (t.billing_amount ?? 0), 0)
  const priorHours = priorCompleted.reduce((s, t) => s + (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0), 0)

  let priorGrossProfit: number | null = null
  if (techsWithCost.length > 0) {
    priorGrossProfit = 0
    for (const tech of techs ?? []) {
      if (tech.hourly_cost != null) {
        const techPriorHours = priorAll
          .filter((t) => t.assigned_technician_id === tech.id && (t.status === 'completed' || t.status === 'billed'))
          .reduce((s, t) => s + (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0), 0)
        const techPriorRevenue = priorAll
          .filter((t) => t.assigned_technician_id === tech.id && (t.status === 'completed' || t.status === 'billed'))
          .reduce((s, t) => s + (t.billing_amount ?? 0), 0)
        priorGrossProfit! += techPriorRevenue - techPriorHours * tech.hourly_cost
      }
    }
  }

  let priorCompDays: number | null = null
  let priorDayCount = 0
  let priorDaySum = 0
  for (const t of priorCompleted) {
    if (t.completed_date && t.scheduled_date) {
      priorDaySum += (new Date(t.completed_date).getTime() - new Date(t.scheduled_date).getTime()) / (1000 * 60 * 60 * 24)
      priorDayCount++
    }
  }
  if (priorDayCount > 0) priorCompDays = priorDaySum / priorDayCount

  // Team trend: last 12 months of aggregated data — trendTickets fetched in parallel above.
  const teamTrend: TrendPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(range.start + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() - i)
    const mr = getMonthRange(d.toISOString().split('T')[0])
    const monthTickets = (trendTickets ?? []).filter(
      (t) => t.completed_date && t.completed_date >= mr.start && t.completed_date <= mr.end + 'T23:59:59Z'
    )
    const mRevenue = monthTickets.reduce((s, t) => s + (t.billing_amount ?? 0), 0)
    const mHours = monthTickets.reduce((s, t) => s + (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0), 0)

    // Gross profit for trend: sum across techs with known hourly_cost
    let mProfit: number | null = null
    if ((techs ?? []).some((t) => t.hourly_cost != null)) {
      mProfit = 0
      for (const tech of techs ?? []) {
        const techMonthTickets = monthTickets.filter((t) => t.assigned_technician_id === tech.id)
        const techRev = techMonthTickets.reduce((s, t) => s + (t.billing_amount ?? 0), 0)
        const techHrs = techMonthTickets.reduce((s, t) => s + (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0), 0)
        if (tech.hourly_cost != null) {
          mProfit! += techRev - techHrs * tech.hourly_cost
        }
      }
    }

    teamTrend.push({
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      ticketsCompleted: monthTickets.length,
      revenue: mRevenue,
      totalHours: mHours,
      grossProfit: mProfit,
    })
  }

  return {
    period: { type: periodType, startDate: range.start, endDate: range.end, label: range.label },
    teamKpis: {
      ticketsCompleted: teamTickets,
      totalRevenue: teamRevenue,
      grossProfit: teamGrossProfit,
      avgHoursPerTicket: teamTickets > 0 ? teamHours / teamTickets : null,
      // AN-23: sum-weighted mean of completion days across the team, not the
      // arithmetic mean of per-tech averages. Computed directly from the raw
      // completed-ticket rows (same source aggregateTechMetrics uses) so a tech
      // who closed 1 ticket doesn't get the same weight as a tech who closed 50.
      avgCompletionDays: (() => {
        const teamCompleted = (currentTickets ?? []).filter(
          (t) => t.status === 'completed' || t.status === 'billed'
        )
        let teamDaySum = 0
        let teamDayCount = 0
        for (const t of teamCompleted) {
          if (t.completed_date && t.scheduled_date) {
            teamDaySum +=
              (new Date(t.completed_date).getTime() - new Date(t.scheduled_date).getTime()) /
              (1000 * 60 * 60 * 24)
            teamDayCount++
          }
        }
        return teamDayCount > 0 ? teamDaySum / teamDayCount : null
      })(),
    },
    priorKpis: {
      ticketsCompleted: priorTicketCount,
      totalRevenue: priorRevenue,
      grossProfit: priorGrossProfit,
      avgHoursPerTicket: priorTicketCount > 0 ? priorHours / priorTicketCount : null,
      avgCompletionDays: priorCompDays,
    },
    techRows,
    teamTrend,
  }
}

// ============================================================
// getTechnicianAnalytics
// ============================================================

export async function getTechnicianAnalytics(
  techId: string,
  periodType: 'weekly' | 'monthly',
  date: string
): Promise<TechnicianAnalytics> {
  const supabase = await createClient()

  const range = periodType === 'monthly' ? getMonthRange(date) : getWeekRange(date)
  const priorRange = getPriorRange(periodType, range.start)
  const yoyRange = getYoyRange(range.start)

  // Fetch tech info
  const { data: tech, error: techErr } = await supabase
    .from('users')
    .select('id, name, hourly_cost')
    .eq('id', techId)
    .single()

  if (techErr) throw techErr

  // Fetch all tickets for this tech (current, prior, yoy periods + last 12 months for trends)
  const trendStart = new Date(range.start + 'T12:00:00Z')
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 11)
  const trendStartStr = trendStart.toISOString().split('T')[0]

  const { data: allTickets, error: tickErr } = await supabase
    .from('pm_tickets')
    .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date')
    .is('deleted_at', null)
    .eq('assigned_technician_id', techId)
    .gte('completed_date', trendStartStr)
    .order('completed_date', { ascending: false })

  if (tickErr) throw tickErr

  // Also fetch non-completed tickets for this period (completion rate denominator).
  //
  // AN-25: For monthly we keep the month/year anchor — same as the team query.
  // For weekly we anchor on scheduled_date <= range.end (tickets eligible to
  // complete in the week). The old month/year filter pulled all 4-5 weeks of
  // the calendar month into a single week's denominator, deflating completion
  // rate for any tech with weekly traffic.
  const curDate = new Date(range.start + 'T12:00:00Z')
  const allStatusQuery =
    periodType === 'weekly'
      ? supabase
          .from('pm_tickets')
          .select('assigned_technician_id, status')
          .is('deleted_at', null)
          .eq('assigned_technician_id', techId)
          .lte('scheduled_date', range.end)
          .or(`completed_date.is.null,completed_date.gte.${range.start}`)
          .not('status', 'in', '("completed","billed")')
      : supabase
          .from('pm_tickets')
          .select('assigned_technician_id, status')
          .is('deleted_at', null)
          .eq('assigned_technician_id', techId)
          .eq('month', curDate.getUTCMonth() + 1)
          .eq('year', curDate.getUTCFullYear())
          .not('status', 'in', '("completed","billed")')
  const { data: allStatusTickets } = await allStatusQuery

  const rawTickets = (allTickets ?? []) as RawTicket[]

  // Current period
  const currentFiltered = rawTickets.filter(
    (t) => t.completed_date && t.completed_date >= range.start && t.completed_date <= range.end + 'T23:59:59Z'
  )
  const currentMerged = [
    ...currentFiltered,
    ...(allStatusTickets ?? []).map((t) => ({ ...t, billing_amount: null, hours_worked: null, additional_hours_worked: null, additional_parts_used: null, completed_date: null, scheduled_date: null })),
  ] as RawTicket[]
  const currentMetrics = aggregateTechMetrics(currentMerged, techId, tech.hourly_cost)

  // Prior period
  const priorFiltered = rawTickets.filter(
    (t) => t.completed_date && t.completed_date >= priorRange.start && t.completed_date <= priorRange.end + 'T23:59:59Z'
  )
  const priorMetrics = aggregateTechMetrics(priorFiltered.map((t) => ({ ...t })), techId, tech.hourly_cost)

  // YoY
  const yoyFiltered = rawTickets.filter(
    (t) => t.completed_date && t.completed_date >= yoyRange.start && t.completed_date <= yoyRange.end + 'T23:59:59Z'
  )
  const hasYoy = yoyFiltered.length > 0
  // AN-22: When the current period has zero completions but the trailing 12 months
  // contain activity, suppress the YoY row. Returning the LY metrics here would
  // pair a 0-numerator current against a positive prior — the consumer's delta()
  // renders that as "-100%", which reads as a real decline rather than "no current
  // activity to compare." Null is the agreed sentinel for "no current activity".
  const trailingHasActivity = rawTickets.some((t) => t.status === 'completed' || t.status === 'billed')
  const currentHasCompletions = currentMetrics.ticketsCompleted > 0
  const yoyMetrics =
    hasYoy && (currentHasCompletions || !trailingHasActivity)
      ? aggregateTechMetrics(yoyFiltered.map((t) => ({ ...t })), techId, tech.hourly_cost)
      : null

  // Trend data (last 12 months)
  const trend: TrendPoint[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(range.start + 'T12:00:00Z')
    d.setUTCMonth(d.getUTCMonth() - i)
    const mr = getMonthRange(d.toISOString().split('T')[0])
    const monthTickets = rawTickets.filter(
      (t) => t.completed_date && t.completed_date >= mr.start && t.completed_date <= mr.end + 'T23:59:59Z'
    )
    const metrics = aggregateTechMetrics(monthTickets.map((t) => ({ ...t })), techId, tech.hourly_cost)
    trend.push({
      month: d.getUTCMonth() + 1,
      year: d.getUTCFullYear(),
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      ticketsCompleted: metrics.ticketsCompleted,
      revenue: metrics.revenue,
      totalHours: metrics.totalHours,
      grossProfit: metrics.grossProfit,
    })
  }

  // Revenue breakdown
  const laborRate = parseFloat((await getSetting('labor_rate_per_hour')) ?? '75')
  let flatRateTotal = 0
  let additionalLaborTotal = 0
  let additionalPartsTotal = 0
  let ticketsWithAdditional = 0

  // Fetch schedule flat rates for current period tickets
  const currentCompletedIds = currentFiltered
    .filter((t) => t.status === 'completed' || t.status === 'billed')

  // To get flat_rate we need to query tickets with schedule join
  const { data: ticketsWithSchedule } = await supabase
    .from('pm_tickets')
    .select('id, billing_amount, additional_hours_worked, additional_parts_used, pm_schedules(flat_rate)')
    .is('deleted_at', null)
    .eq('assigned_technician_id', techId)
    .in('status', ['completed', 'billed'])
    .gte('completed_date', range.start)
    .lte('completed_date', range.end + 'T23:59:59Z')

  for (const t of ticketsWithSchedule ?? []) {
    const schedule = t.pm_schedules as { flat_rate: number | null } | null
    const fr = schedule?.flat_rate ?? 0
    flatRateTotal += fr
    const addLabor = (t.additional_hours_worked ?? 0) * laborRate
    additionalLaborTotal += addLabor
    const parts = (t.additional_parts_used as PartUsed[] | null) ?? []
    const partsCost = parts.reduce((s, p) => s + p.quantity * p.unit_price, 0)
    additionalPartsTotal += partsCost
    if ((t.additional_hours_worked ?? 0) > 0) ticketsWithAdditional++
  }

  const completedCount = currentCompletedIds.length

  // Recent tickets
  const { data: recentRaw } = await supabase
    .from('pm_tickets')
    .select('id, work_order_number, completed_date, hours_worked, additional_hours_worked, billing_amount, status, customers(name)')
    .is('deleted_at', null)
    .eq('assigned_technician_id', techId)
    .in('status', ['completed', 'billed', 'in_progress', 'assigned'])
    .order('completed_date', { ascending: false, nullsFirst: false })
    .limit(10)

  const recentTickets: RecentTicket[] = (recentRaw ?? []).map((t) => {
    const totalHrs = (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0)
    return {
      id: t.id,
      workOrderNumber: t.work_order_number,
      customerName: (t.customers as { name: string } | null)?.name ?? null,
      completedDate: t.completed_date,
      hoursWorked: t.hours_worked,
      additionalHoursWorked: t.additional_hours_worked,
      billingAmount: t.billing_amount,
      status: t.status,
      laborCost: tech.hourly_cost != null ? totalHrs * tech.hourly_cost : null,
    }
  })

  // Targets
  const { data: targets } = await supabase
    .from('technician_targets')
    .select('*')
    .eq('active', true)
    .eq('period_type', periodType)
    .lte('effective_from', date)
    .or(`technician_id.eq.${techId},technician_id.is.null`)
    .order('effective_from', { ascending: false })

  // Two-pass resolution: individual targets always beat team defaults for
  // the same metric, regardless of effective_from ordering. The previous
  // single-pass version had a tautological inner check that meant a more-
  // recent team default could silently override an older individual target.
  const resolvedTargets: ResolvedTarget[] = []
  const seen = new Set<string>()
  // Pass 1 — pick the most-recent individual target per metric.
  for (const t of targets ?? []) {
    if (t.technician_id === techId && !seen.has(t.metric)) {
      resolvedTargets.push({ metric: t.metric, targetValue: t.target_value, periodType: t.period_type })
      seen.add(t.metric)
    }
  }
  // Pass 2 — fill remaining metrics with the most-recent team default.
  for (const t of targets ?? []) {
    if (t.technician_id === null && !seen.has(t.metric)) {
      resolvedTargets.push({ metric: t.metric, targetValue: t.target_value, periodType: t.period_type })
      seen.add(t.metric)
    }
  }

  const makeTechRow = (metrics: Omit<TechRow, 'id' | 'name' | 'hourlyCost' | 'targets'>): TechRow => ({
    id: tech.id,
    name: tech.name,
    hourlyCost: tech.hourly_cost,
    ...metrics,
    targets: resolvedTargets,
  })

  return {
    tech: { id: tech.id, name: tech.name, hourlyCost: tech.hourly_cost },
    period: { type: periodType, startDate: range.start, endDate: range.end, label: range.label },
    current: makeTechRow(currentMetrics),
    prior: makeTechRow(priorMetrics),
    yoy: yoyMetrics ? makeTechRow(yoyMetrics) : null,
    trend,
    revenueBreakdown: {
      flatRate: flatRateTotal,
      additionalLabor: additionalLaborTotal,
      additionalParts: additionalPartsTotal,
      additionalWorkRate: completedCount > 0 ? ticketsWithAdditional / completedCount : 0,
    },
    recentTickets,
    targets: resolvedTargets,
  }
}

// ============================================================
// getTechnicianTargets
// ============================================================

export async function getTechnicianTargets(
  techId?: string
): Promise<TechnicianTargetRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('technician_targets')
    .select('*')
    .eq('active', true)
    .order('effective_from', { ascending: false })

  if (techId) {
    query = query.or(`technician_id.eq.${techId},technician_id.is.null`)
  }

  const { data, error } = await query
  if (error) throw error
  return data as TechnicianTargetRow[]
}

// ============================================================
// setTechnicianTarget
// ============================================================

export async function setTechnicianTarget(
  techId: string | null,
  metric: string,
  value: number,
  periodType: string
): Promise<void> {
  const supabase = await createClient()

  // Deactivate existing
  let deactivateQuery = supabase
    .from('technician_targets')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('metric', metric)
    .eq('period_type', periodType)
    .eq('active', true)

  if (techId) {
    deactivateQuery = deactivateQuery.eq('technician_id', techId)
  } else {
    deactivateQuery = deactivateQuery.is('technician_id', null)
  }

  await deactivateQuery

  // Insert new
  const { error } = await supabase
    .from('technician_targets')
    .insert({
      technician_id: techId,
      metric,
      target_value: value,
      period_type: periodType,
    })

  if (error) throw error
}
