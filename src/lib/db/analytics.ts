import { createClient } from '@/lib/supabase/server'
import { TechnicianTargetRow, PartUsed, UserRole } from '@/types/database'
import { getSetting } from '@/lib/db/settings'

// ============================================================
// Ticket-type scope
// ============================================================
//
// The analytics engine covers TWO ticket tables that live entirely separately
// (no shared discriminator column): `pm_tickets` (preventive maintenance) and
// `service_tickets` (on-demand service/repair). A `TicketType` selects the
// scope; `combined` unions both by `assigned_technician_id`. Service rows are
// normalized into the PM-shaped `RawTicket` so the existing per-tech
// aggregation is reused unchanged.
//
// Field reconciliation (PM -> service): PM `completed_date` (DATE) maps to
// service `completed_at` (TIMESTAMPTZ); service has no `additional_hours_worked`
// (-> 0) and no schedule, so "days to complete" uses `completed_at - created_at`
// (we set the normalized `scheduled_date` to `created_at`) versus PM's
// completed-minus-scheduled. Both tables always filter `deleted_at IS NULL`.

export type TicketType = 'pm' | 'service' | 'combined'

type DbClient = Awaited<ReturnType<typeof createClient>>
type EmptyRes = { data: unknown[]; error: null }
const EMPTY_RES: EmptyRes = { data: [], error: null }

const PM_COMPLETED_SELECT =
  'assigned_technician_id, status, billing_amount, hours_worked, additional_hours_worked, additional_parts_used, completed_date, scheduled_date'
const SERVICE_COMPLETED_SELECT =
  'assigned_technician_id, status, billing_amount, hours_worked, completed_at, created_at'

type RawServiceCompleted = {
  assigned_technician_id: string | null
  status: string
  billing_amount: number | null
  hours_worked: number | null
  completed_at: string | null
  created_at: string
}

// Map a completed service row into the PM-shaped RawTicket. `completed_at` is
// the period anchor; `scheduled_date <- created_at` makes aggregateTechMetrics'
// (completed - scheduled) compute open-to-close days for service.
function normalizeServiceCompleted(r: RawServiceCompleted): RawTicket {
  return {
    assigned_technician_id: r.assigned_technician_id,
    status: r.status, // 'completed' | 'billed' — already PM vocabulary
    billing_amount: r.billing_amount,
    hours_worked: r.hours_worked,
    additional_hours_worked: 0,
    additional_parts_used: null,
    completed_date: r.completed_at,
    scheduled_date: r.created_at,
  }
}

// An in-flight (not-yet-completed) row with metrics nulled — only `status`
// matters, feeding the completion-rate denominator. Mirrors the PM allStatus
// merge that has always null-ed these fields.
function nullActiveRow(techId: string | null, status: string): RawTicket {
  return {
    assigned_technician_id: techId,
    status,
    billing_amount: null,
    hours_worked: null,
    additional_hours_worked: null,
    additional_parts_used: null,
    completed_date: null,
    scheduled_date: null,
  }
}

// Fold a service open-status into the PM vocabulary aggregateTechMetrics treats
// as "active" (part of the completion-rate denominator).
function mapServiceActiveStatus(s: string): string {
  return s === 'in_progress' ? 'in_progress' : 'assigned'
}

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
    for (const t of next.recentTickets) {
      t.profit = null
      t.laborCost = null
    }
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

export type AgingBucket = { bucket: '0-7' | '8-30' | '31+'; count: number }

export type BacklogMetrics = {
  totalOpen: number
  aging: AgingBucket[]
  avgAgeDays: number | null
  byTechnician: { id: string | null; name: string; count: number }[]
  // Service tickets carry a priority; PM tickets don't. Null when scope is PM-only.
  priorityMix: { priority: string; count: number }[] | null
  oldestOpen: {
    id: string
    workOrderNumber: number | null
    source: 'pm' | 'service'
    customerName: string | null
    ageDays: number
    technicianName: string | null
    status: string
  }[]
}

export type TeamAnalytics = {
  ticketType: TicketType
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
  backlog: BacklogMetrics
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
  ticketType: TicketType
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
  source: 'pm' | 'service'
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

// ============================================================
// Ticket fetch helpers (type-aware, union PM + service)
// ============================================================

// Completed rows (revenue/hours source) in [start, end]. PM keeps its
// all-statuses-in-range behavior; service is filtered to completed/billed
// because `completed_at` is only set on completion.
async function getCompletedRows(
  supabase: DbClient,
  type: TicketType,
  start: string,
  end: string
): Promise<RawTicket[]> {
  const includePm = type !== 'service'
  const includeService = type !== 'pm'
  const [pmRes, svcRes] = await Promise.all([
    includePm
      ? supabase
          .from('pm_tickets')
          .select(PM_COMPLETED_SELECT)
          .is('deleted_at', null)
          .gte('completed_date', start)
          .lte('completed_date', end + 'T23:59:59Z')
      : Promise.resolve(EMPTY_RES),
    includeService
      ? supabase
          .from('service_tickets')
          .select(SERVICE_COMPLETED_SELECT)
          .is('deleted_at', null)
          .in('status', ['completed', 'billed'])
          .gte('completed_at', start)
          .lte('completed_at', end + 'T23:59:59Z')
      : Promise.resolve(EMPTY_RES),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error
  const pmRows = (pmRes.data ?? []) as RawTicket[]
  const svcRows = ((svcRes.data ?? []) as RawServiceCompleted[]).map(normalizeServiceCompleted)
  return [...pmRows, ...svcRows]
}

// In-flight (open) rows for the current-period completion-rate denominator,
// metrics null-ed. PM reproduces the AN-25 weekly/monthly eligibility logic;
// service adds all currently-open tickets (no schedule to key a period on).
async function getActiveRows(
  supabase: DbClient,
  type: TicketType,
  periodType: 'weekly' | 'monthly',
  range: { start: string; end: string },
  curDate: Date,
  techId?: string
): Promise<RawTicket[]> {
  const includePm = type !== 'service'
  const includeService = type !== 'pm'

  const pmQuery = () => {
    // AN-25: weekly anchors on scheduled_date (tickets eligible to complete in
    // the week); monthly anchors on the month/year columns.
    let q =
      periodType === 'weekly'
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
            .eq('year', curDate.getUTCFullYear())
    if (techId) q = q.eq('assigned_technician_id', techId)
    return q
  }

  const svcQuery = () => {
    let q = supabase
      .from('service_tickets')
      .select('assigned_technician_id, status')
      .is('deleted_at', null)
      .in('status', ['open', 'estimated', 'approved', 'in_progress'])
    if (techId) q = q.eq('assigned_technician_id', techId)
    return q
  }

  const [pmRes, svcRes] = await Promise.all([
    includePm ? pmQuery() : Promise.resolve(EMPTY_RES),
    includeService ? svcQuery() : Promise.resolve(EMPTY_RES),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const pmActive = ((pmRes.data ?? []) as { assigned_technician_id: string | null; status: string }[])
    .filter((t) => !['completed', 'billed'].includes(t.status))
    .map((t) => nullActiveRow(t.assigned_technician_id, t.status))
  const svcActive = ((svcRes.data ?? []) as { assigned_technician_id: string | null; status: string }[])
    .map((t) => nullActiveRow(t.assigned_technician_id, mapServiceActiveStatus(t.status)))
  return [...pmActive, ...svcActive]
}

// Completed rows since `sinceDate` for the 12-month trend, normalized.
async function getTrendRows(supabase: DbClient, type: TicketType, sinceDate: string, techId?: string): Promise<RawTicket[]> {
  const includePm = type !== 'service'
  const includeService = type !== 'pm'
  const pmQuery = () => {
    // Full completed-row shape (incl. scheduled_date) — this feeds the per-tech
    // rawTickets that aggregateTechMetrics reduces, and it needs scheduled_date
    // to compute PM "Avg Completion" (completed_date - scheduled_date).
    let q = supabase
      .from('pm_tickets')
      .select(PM_COMPLETED_SELECT)
      .is('deleted_at', null)
      .in('status', ['completed', 'billed'])
      .gte('completed_date', sinceDate)
    if (techId) q = q.eq('assigned_technician_id', techId)
    return q
  }
  const svcQuery = () => {
    let q = supabase
      .from('service_tickets')
      .select(SERVICE_COMPLETED_SELECT)
      .is('deleted_at', null)
      .in('status', ['completed', 'billed'])
      .gte('completed_at', sinceDate)
    if (techId) q = q.eq('assigned_technician_id', techId)
    return q
  }
  const [pmRes, svcRes] = await Promise.all([
    includePm ? pmQuery() : Promise.resolve(EMPTY_RES),
    includeService ? svcQuery() : Promise.resolve(EMPTY_RES),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error
  const pmRows = (pmRes.data ?? []) as RawTicket[]
  const svcRows = ((svcRes.data ?? []) as RawServiceCompleted[]).map(normalizeServiceCompleted)
  return [...pmRows, ...svcRows]
}

// ============================================================
// computeBacklog — point-in-time open-work snapshot ("as of now")
// ============================================================

type OpenRowJoin = {
  id: string
  work_order_number: number | null
  status: string
  priority?: string | null
  created_at: string
  assigned_technician_id: string | null
  customers: { name: string } | null
}

export async function computeBacklog(
  supabase: DbClient,
  type: TicketType,
  techs: { id: string; name: string }[]
): Promise<BacklogMetrics> {
  const includePm = type !== 'service'
  const includeService = type !== 'pm'

  const [pmRes, svcRes] = await Promise.all([
    includePm
      ? supabase
          .from('pm_tickets')
          .select('id, work_order_number, status, created_at, assigned_technician_id, customers(name)')
          .is('deleted_at', null)
          .in('status', ['unassigned', 'assigned', 'in_progress', 'skip_requested'])
      : Promise.resolve(EMPTY_RES),
    includeService
      ? supabase
          .from('service_tickets')
          .select('id, work_order_number, status, priority, created_at, assigned_technician_id, customers(name)')
          .is('deleted_at', null)
          .in('status', ['open', 'estimated', 'approved', 'in_progress'])
      : Promise.resolve(EMPTY_RES),
  ])
  if (pmRes.error) throw pmRes.error
  if (svcRes.error) throw svcRes.error

  const now = Date.now()
  const techName = new Map(techs.map((t) => [t.id, t.name]))
  const DAY = 1000 * 60 * 60 * 24

  type OpenRow = {
    id: string
    workOrderNumber: number | null
    source: 'pm' | 'service'
    status: string
    priority: string | null
    ageDays: number
    techId: string | null
    customerName: string | null
  }
  const rows: OpenRow[] = []
  const push = (r: OpenRowJoin, source: 'pm' | 'service') => {
    rows.push({
      id: r.id,
      workOrderNumber: r.work_order_number,
      source,
      status: r.status,
      priority: r.priority ?? null,
      ageDays: (now - new Date(r.created_at).getTime()) / DAY,
      techId: r.assigned_technician_id,
      customerName: r.customers?.name ?? null,
    })
  }
  for (const r of (pmRes.data ?? []) as OpenRowJoin[]) push(r, 'pm')
  for (const r of (svcRes.data ?? []) as OpenRowJoin[]) push(r, 'service')

  const totalOpen = rows.length
  const buckets = { '0-7': 0, '8-30': 0, '31+': 0 }
  let ageSum = 0
  for (const r of rows) {
    ageSum += r.ageDays
    if (r.ageDays <= 7) buckets['0-7']++
    else if (r.ageDays <= 30) buckets['8-30']++
    else buckets['31+']++
  }
  const avgAgeDays = totalOpen > 0 ? ageSum / totalOpen : null

  const byTechMap = new Map<string, number>()
  for (const r of rows) {
    const key = r.techId ?? '__unassigned__'
    byTechMap.set(key, (byTechMap.get(key) ?? 0) + 1)
  }
  const byTechnician = [...byTechMap.entries()]
    .map(([key, count]) => ({
      id: key === '__unassigned__' ? null : key,
      name: key === '__unassigned__' ? 'Unassigned' : techName.get(key) ?? 'Unknown',
      count,
    }))
    .sort((a, b) => b.count - a.count)

  // Priority is a service-only concept. In combined scope this reflects the
  // service portion of the backlog; null when scope is PM-only.
  let priorityMix: { priority: string; count: number }[] | null = null
  if (includeService) {
    const pmap = new Map<string, number>()
    for (const r of rows) {
      if (r.source === 'service' && r.priority) pmap.set(r.priority, (pmap.get(r.priority) ?? 0) + 1)
    }
    priorityMix = ['emergency', 'standard', 'low'].map((p) => ({ priority: p, count: pmap.get(p) ?? 0 }))
  }

  const oldestOpen = [...rows]
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      workOrderNumber: r.workOrderNumber,
      source: r.source,
      customerName: r.customerName,
      ageDays: Math.round(r.ageDays),
      technicianName: r.techId ? techName.get(r.techId) ?? null : null,
      status: r.status,
    }))

  return {
    totalOpen,
    aging: [
      { bucket: '0-7', count: buckets['0-7'] },
      { bucket: '8-30', count: buckets['8-30'] },
      { bucket: '31+', count: buckets['31+'] },
    ],
    avgAgeDays,
    byTechnician,
    priorityMix,
    oldestOpen,
  }
}

// ============================================================
// getTeamAnalytics
// ============================================================

export async function getTeamAnalytics(
  periodType: 'weekly' | 'monthly',
  date: string,
  ticketType: TicketType = 'combined'
): Promise<TeamAnalytics> {
  const supabase = await createClient()

  const range = periodType === 'monthly' ? getMonthRange(date) : getWeekRange(date)
  const priorRange = getPriorRange(periodType, range.start)

  // Fetch technicians first — downstream resolveTargets, tech-row build, and
  // backlog name resolution depend on this list.
  const { data: techs, error: techErr } = await supabase
    .from('users')
    .select('id, name, hourly_cost')
    .eq('role', 'technician')
    .eq('active', true)
    .order('name')

  if (techErr) throw techErr

  // Trend window (last 12 months).
  const trendStart = new Date(range.start + 'T12:00:00Z')
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 11)
  const trendStartStr = trendStart.toISOString().split('T')[0]
  const curDate = new Date(range.start + 'T12:00:00Z')

  // All independent — run in parallel. Each ticket helper internally unions PM
  // + service per `ticketType`.
  const [currentTickets, priorTickets, activeRows, targetsRes, trendTickets, backlog] = await Promise.all([
    getCompletedRows(supabase, ticketType, range.start, range.end),
    getCompletedRows(supabase, ticketType, priorRange.start, priorRange.end),
    getActiveRows(supabase, ticketType, periodType, range, curDate),
    supabase
      .from('technician_targets')
      .select('*')
      .eq('active', true)
      .eq('period_type', periodType)
      .lte('effective_from', date)
      .order('effective_from', { ascending: false }),
    getTrendRows(supabase, ticketType, trendStartStr),
    computeBacklog(supabase, ticketType, techs ?? []),
  ])

  const targets = targetsRes.data

  // Merge completed tickets with active tickets for the completion-rate
  // denominator (activeRows are already non-completed and null-ed).
  const mergedCurrent: RawTicket[] = [...currentTickets, ...activeRows]

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
  const priorAll = priorTickets
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
    const monthTickets = trendTickets.filter(
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
    ticketType,
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
        const teamCompleted = currentTickets.filter(
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
    backlog,
  }
}

// ============================================================
// getTechnicianAnalytics
// ============================================================

export async function getTechnicianAnalytics(
  techId: string,
  periodType: 'weekly' | 'monthly',
  date: string,
  ticketType: TicketType = 'combined'
): Promise<TechnicianAnalytics> {
  const supabase = await createClient()

  const includePm = ticketType !== 'service'
  const includeService = ticketType !== 'pm'

  const range = periodType === 'monthly' ? getMonthRange(date) : getWeekRange(date)
  const priorRange = getPriorRange(periodType, range.start)
  const yoyRange = getYoyRange(range.start)

  const trendStart = new Date(range.start + 'T12:00:00Z')
  trendStart.setUTCMonth(trendStart.getUTCMonth() - 11)
  const trendStartStr = trendStart.toISOString().split('T')[0]

  const curDate = new Date(range.start + 'T12:00:00Z')

  const [
    techRes,
    completedRows,
    activeRows,
    schedRes,
    pmRecentRes,
    targetsRes,
    laborRateSetting,
    svcRecentRes,
  ] = await Promise.all([
    supabase.from('users').select('id, name, hourly_cost').eq('id', techId).single(),
    // Completed rows (last 12 months) for this tech — PM + service unioned.
    getTrendRows(supabase, ticketType, trendStartStr, techId),
    // Active rows for the completion-rate denominator (current period).
    getActiveRows(supabase, ticketType, periodType, range, curDate, techId),
    // Flat-rate breakdown source (schedule join) — PM only.
    includePm
      ? supabase
          .from('pm_tickets')
          .select('id, billing_amount, additional_hours_worked, additional_parts_used, pm_schedules(flat_rate)')
          .is('deleted_at', null)
          .eq('assigned_technician_id', techId)
          .in('status', ['completed', 'billed'])
          .gte('completed_date', range.start)
          .lte('completed_date', range.end + 'T23:59:59Z')
      : Promise.resolve(EMPTY_RES),
    // Recent PM tickets.
    includePm
      ? supabase
          .from('pm_tickets')
          .select('id, work_order_number, completed_date, hours_worked, additional_hours_worked, billing_amount, status, customers(name)')
          .is('deleted_at', null)
          .eq('assigned_technician_id', techId)
          .in('status', ['completed', 'billed', 'in_progress', 'assigned'])
          .order('completed_date', { ascending: false, nullsFirst: false })
          .limit(10)
      : Promise.resolve(EMPTY_RES),
    // Targets (individual + team defaults, resolved below).
    supabase
      .from('technician_targets')
      .select('*')
      .eq('active', true)
      .eq('period_type', periodType)
      .lte('effective_from', date)
      .or(`technician_id.eq.${techId},technician_id.is.null`)
      .order('effective_from', { ascending: false }),
    getSetting('labor_rate_per_hour'),
    // Recent service tickets.
    includeService
      ? supabase
          .from('service_tickets')
          .select('id, work_order_number, completed_at, hours_worked, billing_amount, status, customers(name)')
          .is('deleted_at', null)
          .eq('assigned_technician_id', techId)
          .in('status', ['completed', 'billed', 'in_progress', 'open', 'estimated', 'approved'])
          .order('completed_at', { ascending: false, nullsFirst: false })
          .limit(10)
      : Promise.resolve(EMPTY_RES),
  ])

  const { data: tech, error: techErr } = techRes
  if (techErr) throw techErr

  const rawTickets = completedRows

  // Current period
  const currentFiltered = rawTickets.filter(
    (t) => t.completed_date && t.completed_date >= range.start && t.completed_date <= range.end + 'T23:59:59Z'
  )
  const currentMerged: RawTicket[] = [...currentFiltered, ...activeRows]
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
  // AN-22: suppress YoY when the current period has zero completions but the
  // trailing 12 months contain activity (avoids a false "-100%").
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

  // Revenue breakdown (PM-only — flat rate comes from pm_schedules). Zeros for
  // service/combined scope; the profile hides the card unless scope is 'pm'.
  const laborRate = parseFloat(laborRateSetting ?? '75')
  let flatRateTotal = 0
  let additionalLaborTotal = 0
  let additionalPartsTotal = 0
  let ticketsWithAdditional = 0

  const ticketsWithSchedule = (schedRes.data ?? []) as Array<{
    additional_hours_worked: number | null
    additional_parts_used: PartUsed[] | null
    pm_schedules: { flat_rate: number | null } | null
  }>
  for (const t of ticketsWithSchedule) {
    const fr = t.pm_schedules?.flat_rate ?? 0
    flatRateTotal += fr
    const addLabor = (t.additional_hours_worked ?? 0) * laborRate
    additionalLaborTotal += addLabor
    const parts = (t.additional_parts_used as PartUsed[] | null) ?? []
    const partsCost = parts.reduce((s, p) => s + p.quantity * p.unit_price, 0)
    additionalPartsTotal += partsCost
    if ((t.additional_hours_worked ?? 0) > 0) ticketsWithAdditional++
  }
  const breakdownCompletedCount = ticketsWithSchedule.length

  // Recent tickets — union PM + service, tag source, most-recent first.
  type RecentJoin = {
    id: string
    work_order_number: number
    completed_date?: string | null
    completed_at?: string | null
    hours_worked: number | null
    additional_hours_worked?: number | null
    billing_amount: number | null
    status: string
    customers: { name: string } | null
  }
  const pmRecent: RecentTicket[] = ((pmRecentRes.data ?? []) as RecentJoin[]).map((t) => {
    const totalHrs = (t.hours_worked ?? 0) + (t.additional_hours_worked ?? 0)
    return {
      id: t.id,
      workOrderNumber: t.work_order_number,
      source: 'pm',
      customerName: t.customers?.name ?? null,
      completedDate: t.completed_date ?? null,
      hoursWorked: t.hours_worked,
      additionalHoursWorked: t.additional_hours_worked ?? null,
      billingAmount: t.billing_amount,
      status: t.status,
      laborCost: tech.hourly_cost != null ? totalHrs * tech.hourly_cost : null,
    }
  })
  const svcRecent: RecentTicket[] = ((svcRecentRes.data ?? []) as RecentJoin[]).map((t) => ({
    id: t.id,
    workOrderNumber: t.work_order_number,
    source: 'service',
    customerName: t.customers?.name ?? null,
    completedDate: t.completed_at ?? null,
    hoursWorked: t.hours_worked,
    additionalHoursWorked: null,
    billingAmount: t.billing_amount,
    status: t.status,
    laborCost: tech.hourly_cost != null ? (t.hours_worked ?? 0) * tech.hourly_cost : null,
  }))
  const recentTickets: RecentTicket[] = [...pmRecent, ...svcRecent]
    .sort((a, b) => {
      const da = a.completedDate ? new Date(a.completedDate).getTime() : 0
      const db = b.completedDate ? new Date(b.completedDate).getTime() : 0
      return db - da
    })
    .slice(0, 10)

  // Targets (fetched in the Promise.all above)
  const { data: targets } = targetsRes

  // Two-pass resolution: individual targets always beat team defaults for the
  // same metric, regardless of effective_from ordering.
  const resolvedTargets: ResolvedTarget[] = []
  const seen = new Set<string>()
  for (const t of targets ?? []) {
    if (t.technician_id === techId && !seen.has(t.metric)) {
      resolvedTargets.push({ metric: t.metric, targetValue: t.target_value, periodType: t.period_type })
      seen.add(t.metric)
    }
  }
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
    ticketType,
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
      additionalWorkRate: breakdownCompletedCount > 0 ? ticketsWithAdditional / breakdownCompletedCount : 0,
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
