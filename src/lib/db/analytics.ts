import { createClient } from '@/lib/supabase/server'
import { TechnicianTargetRow, PartUsed } from '@/types/database'
import { getSetting } from '@/lib/db/settings'

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
  const laborCost = hourlyCost != null ? totalHours * hourlyCost : null
  const grossProfit = laborCost != null ? revenue - laborCost : null
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

  // Fetch technicians
  const { data: techs, error: techErr } = await supabase
    .from('users')
    .select('id, name, hourly_cost')
    .eq('role', 'technician')
    .eq('active', true)
    .order('name')

  if (techErr) throw techErr

  // Fetch tickets for current + prior period
  const { data: currentTickets, error: curErr } = await supabase
    .from('pm_tickets')
    .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date')
    .gte('completed_date', range.start)
    .lte('completed_date', range.end + 'T23:59:59Z')

  if (curErr) throw curErr

  const { data: priorTickets, error: priorErr } = await supabase
    .from('pm_tickets')
    .select('assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date')
    .gte('completed_date', priorRange.start)
    .lte('completed_date', priorRange.end + 'T23:59:59Z')

  if (priorErr) throw priorErr

  // Also fetch assigned/in_progress/skipped tickets for completion rate (current period uses month/year)
  const curDate = new Date(range.start + 'T12:00:00Z')
  const { data: allStatusTickets } = await supabase
    .from('pm_tickets')
    .select('assigned_technician_id, status')
    .eq('month', curDate.getUTCMonth() + 1)
    .eq('year', curDate.getUTCFullYear())

  // Merge completed tickets with all-status tickets for completion rate calculation
  const mergedCurrent = [
    ...(currentTickets ?? []),
    ...(allStatusTickets ?? []).filter(
      (t) => !['completed', 'billed'].includes(t.status)
    ).map((t) => ({ ...t, billing_amount: null, hours_worked: null, additional_hours_worked: null, additional_parts_used: null, completed_date: null, scheduled_date: null })),
  ] as RawTicket[]

  // Fetch targets
  const { data: targets } = await supabase
    .from('technician_targets')
    .select('*')
    .eq('active', true)
    .eq('period_type', periodType)
    .lte('effective_from', date)
    .order('effective_from', { ascending: false })

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

  return {
    period: { type: periodType, startDate: range.start, endDate: range.end, label: range.label },
    teamKpis: {
      ticketsCompleted: teamTickets,
      totalRevenue: teamRevenue,
      grossProfit: teamGrossProfit,
      avgHoursPerTicket: teamTickets > 0 ? teamHours / teamTickets : null,
      avgCompletionDays: (() => {
        const withDays = techRows.filter((r) => r.avgCompletionDays != null)
        if (withDays.length === 0) return null
        return withDays.reduce((s, r) => s + r.avgCompletionDays!, 0) / withDays.length
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
    .eq('assigned_technician_id', techId)
    .gte('completed_date', trendStartStr)
    .order('completed_date', { ascending: false })

  if (tickErr) throw tickErr

  // Also fetch non-completed tickets for this month (completion rate)
  const curDate = new Date(range.start + 'T12:00:00Z')
  const { data: allStatusTickets } = await supabase
    .from('pm_tickets')
    .select('assigned_technician_id, status')
    .eq('assigned_technician_id', techId)
    .eq('month', curDate.getUTCMonth() + 1)
    .eq('year', curDate.getUTCFullYear())
    .not('status', 'in', '("completed","billed")')

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
  const yoyMetrics = hasYoy ? aggregateTechMetrics(yoyFiltered.map((t) => ({ ...t })), techId, tech.hourly_cost) : null

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

  const resolvedTargets: ResolvedTarget[] = []
  const seen = new Set<string>()
  for (const t of targets ?? []) {
    if (!seen.has(t.metric)) {
      // Individual targets take priority over team defaults
      if (t.technician_id === techId || !seen.has(t.metric)) {
        resolvedTargets.push({ metric: t.metric, targetValue: t.target_value, periodType: t.period_type })
        seen.add(t.metric)
      }
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
