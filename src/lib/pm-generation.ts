// PM ticket generation — shared between the monthly "Generate [Month] PMs"
// modal and the new "auto-backfill on schedule create" path.
//
// Two scopes:
//   - all_active_for_month: fetch every active schedule, generate cycle-matching
//     ones for the given month/year. Used by /api/tickets/generate.
//   - one_schedule: scoped to a single newly-created schedule, generate any
//     cycle-matching months in the provided list. Used by /api/pm-schedules
//     for year-to-date backfill.
//
// Two credit-hold modes:
//   - 'skip': caller (the monthly modal) prompts the user; ids in
//     skipCreditHoldCustomerIds are excluded from generation. Mirrors the
//     pre-refactor monthly-flow behavior exactly.
//   - 'flag': caller (backfill) cannot prompt, so credit-hold customers are
//     generated with requires_review=true and review_reason='credit_hold_at_backfill'.
//     skipCreditHoldCustomerIds is rejected (treated as caller error).
//
// Idempotency: relies on the existing unique constraint
// (pm_schedule_id, month, year) on pm_tickets. Per-month pre-fetch of existing
// tickets short-circuits the obvious duplicates; the upsert with
// onConflict ignoreDuplicates handles concurrent races.

import { SupabaseClient } from '@supabase/supabase-js'
import {
  Database,
  EquipmentRow,
  PmScheduleRow,
  PmTicketInsert,
  PmTicketRow,
  TicketStatus,
} from '@/types/database'

export type PmSupabaseClient = SupabaseClient<Database>

export type ScheduleWithEquipment = PmScheduleRow & {
  equipment: (EquipmentRow & {
    customers: { id: number; name: string; credit_hold: boolean } | null
  }) | null
}

export type GenerateScope =
  | { kind: 'all_active_for_month'; month: number; year: number }
  | { kind: 'one_schedule'; scheduleId: string; months: { month: number; year: number }[] }

export interface GeneratePmTicketsArgs {
  supabase: PmSupabaseClient
  scope: GenerateScope
  createdById: string | null
  preview?: boolean
  skipCreditHoldCustomerIds?: number[]
  creditHoldReviewMode: 'skip' | 'flag'
}

export interface GeneratePmTicketsResult {
  // Count of rows actually inserted (always 0 in preview).
  created: number
  // Count of rows that would be / were attempted (populated in both preview and live).
  attempted: number
  skipped: number
  skippedCreditHold: number
  flagged: number
  tickets: PmTicketRow[]
  creditHoldCustomers: { id: number; name: string; equipmentCount: number }[]
  monthsProcessed: { month: number; year: number }[]
}

// Pure: does this schedule's cycle land on the given calendar month?
// e.g. anchor=10 (Oct), interval=3 → matches Oct(0), Jan(3), Apr(6), Jul(9)
// Double-mod ((x % n) + n) % n normalizes negative remainders.
export function scheduleMatchesMonth(
  schedule: Pick<PmScheduleRow, 'interval_months' | 'anchor_month'>,
  month: number
): boolean {
  const offset = ((month - schedule.anchor_month) % 12 + 12) % 12
  return offset % schedule.interval_months === 0
}

// Pure: list every cycle-matching month from Jan 1 of currentYear up to
// currentMonth inclusive. Used by backfill on schedule create.
export function backfillMonths(
  anchorMonth: number,
  intervalMonths: number,
  currentMonth: number,
  currentYear: number
): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = []
  for (let m = 1; m <= currentMonth; m++) {
    if (scheduleMatchesMonth({ anchor_month: anchorMonth, interval_months: intervalMonths }, m)) {
      out.push({ month: m, year: currentYear })
    }
  }
  return out
}

// Pure: list every cycle-matching month from (startYear, startMonth) through
// (endYear, endMonth), inclusive. Spans year boundaries — used by the
// starting_year-aware backfill in POST /api/pm-schedules where the user can
// pick a starting_year that puts the first PM in the prior calendar year
// (within the 3-month recency window enforced by the route).
export function monthsInRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  anchorMonth: number,
  intervalMonths: number
): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = []
  let y = startYear
  let m = startMonth
  while (y < endYear || (y === endYear && m <= endMonth)) {
    if (scheduleMatchesMonth({ anchor_month: anchorMonth, interval_months: intervalMonths }, m)) {
      out.push({ month: m, year: y })
    }
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export async function generatePmTickets(
  args: GeneratePmTicketsArgs
): Promise<GeneratePmTicketsResult> {
  const {
    supabase,
    scope,
    createdById,
    preview = false,
    skipCreditHoldCustomerIds = [],
    creditHoldReviewMode,
  } = args

  if (creditHoldReviewMode === 'flag' && skipCreditHoldCustomerIds.length > 0) {
    throw new Error('skipCreditHoldCustomerIds is not supported in flag mode')
  }

  const aggregate: GeneratePmTicketsResult = {
    created: 0,
    attempted: 0,
    skipped: 0,
    skippedCreditHold: 0,
    flagged: 0,
    tickets: [],
    creditHoldCustomers: [],
    monthsProcessed: [],
  }

  const months: { month: number; year: number }[] =
    scope.kind === 'all_active_for_month'
      ? [{ month: scope.month, year: scope.year }]
      : scope.months

  for (const m of months) {
    const monthResult = await generateForMonth({
      supabase,
      scope,
      target: m,
      createdById,
      preview,
      skipCreditHoldCustomerIds,
      creditHoldReviewMode,
    })

    aggregate.created += monthResult.created.length
    aggregate.attempted += monthResult.attempted
    aggregate.skipped += monthResult.skipped
    aggregate.skippedCreditHold += monthResult.skippedCreditHold
    aggregate.flagged += monthResult.flaggedCount
    aggregate.tickets.push(...monthResult.created)
    aggregate.monthsProcessed.push(m)

    for (const c of monthResult.creditHoldCustomers) {
      const existing = aggregate.creditHoldCustomers.find((x) => x.id === c.id)
      if (existing) existing.equipmentCount += c.equipmentCount
      else aggregate.creditHoldCustomers.push({ ...c })
    }
  }

  aggregate.creditHoldCustomers.sort((a, b) => a.name.localeCompare(b.name))
  return aggregate
}

interface MonthRunResult {
  created: PmTicketRow[]
  attempted: number
  skipped: number
  skippedCreditHold: number
  flaggedCount: number
  creditHoldCustomers: { id: number; name: string; equipmentCount: number }[]
}

async function generateForMonth(args: {
  supabase: PmSupabaseClient
  scope: GenerateScope
  target: { month: number; year: number }
  createdById: string | null
  preview: boolean
  skipCreditHoldCustomerIds: number[]
  creditHoldReviewMode: 'skip' | 'flag'
}): Promise<MonthRunResult> {
  const { supabase, scope, target, createdById, preview, skipCreditHoldCustomerIds, creditHoldReviewMode } = args
  const { month, year } = target

  const baseSelect = `
    id, equipment_id, interval_months, anchor_month, active, billing_type, flat_rate,
    equipment(id, customer_id, active, default_technician_id, default_products,
      customers(id, name, credit_hold))
  `

  let schedulesQuery = supabase.from('pm_schedules').select(baseSelect).eq('active', true)
  if (scope.kind === 'one_schedule') {
    schedulesQuery = schedulesQuery.eq('id', scope.scheduleId)
  }

  const { data: rawSchedules, error: schedulesError } = await schedulesQuery
  if (schedulesError) throw schedulesError
  const schedules = (rawSchedules ?? []) as unknown as ScheduleWithEquipment[]

  // Pre-fetch existing tickets for this month/year (deleted_at-inclusive — soft
  // deletes still block regeneration on purpose).
  const { data: existingTickets, error: existingError } = await supabase
    .from('pm_tickets')
    .select('pm_schedule_id, equipment_id')
    .eq('month', month)
    .eq('year', year)
  if (existingError) throw existingError
  const existingScheduleIds = new Set(
    (existingTickets ?? []).map((t) => t.pm_schedule_id).filter(Boolean)
  )
  const existingEquipmentIds = new Set(
    (existingTickets ?? []).map((t) => t.equipment_id).filter(Boolean)
  )

  const skipCreditHoldSet = new Set<number>(skipCreditHoldCustomerIds)
  const creditHoldCustomers = new Map<number, { id: number; name: string; equipmentCount: number }>()
  const ticketsToCreate: PmTicketInsert[] = []
  let skipped = 0
  let skippedCreditHold = 0

  for (const schedule of schedules) {
    if (!scheduleMatchesMonth(schedule, month)) continue

    const equipment = schedule.equipment
    if (!equipment || !equipment.active) {
      skipped++
      continue
    }

    if (existingScheduleIds.has(schedule.id)) {
      skipped++
      continue
    }

    if (existingEquipmentIds.has(schedule.equipment_id)) {
      skipped++
      continue
    }

    const customer = equipment.customers
    let onCreditHold = false
    if (customer?.credit_hold) {
      onCreditHold = true
      const existing = creditHoldCustomers.get(customer.id)
      if (existing) {
        existing.equipmentCount++
      } else {
        creditHoldCustomers.set(customer.id, {
          id: customer.id,
          name: customer.name,
          equipmentCount: 1,
        })
      }

      if (creditHoldReviewMode === 'skip' && !preview && skipCreditHoldSet.has(customer.id)) {
        skipped++
        skippedCreditHold++
        continue
      }
    }

    const status: TicketStatus = equipment.default_technician_id ? 'assigned' : 'unassigned'
    const flagForCreditHold = onCreditHold && creditHoldReviewMode === 'flag'

    ticketsToCreate.push({
      pm_schedule_id: schedule.id,
      equipment_id: schedule.equipment_id,
      customer_id: equipment.customer_id,
      assigned_technician_id: equipment.default_technician_id ?? null,
      month,
      year,
      status,
      requires_review: flagForCreditHold,
      review_reason: flagForCreditHold ? 'credit_hold_at_backfill' : null,
      parts_used: (equipment.default_products ?? []).map((p) => ({
        synergy_product_id: p.synergy_product_id,
        quantity: p.quantity,
        description: p.description,
        unit_price: 0,
      })),
      created_by_id: createdById,
    })
  }

  // Prior-PM flagging (same logic as before) — only escalates rows that aren't
  // already flagged by the credit-hold branch above.
  const equipmentIdsToCreate = ticketsToCreate
    .map((t) => t.equipment_id)
    .filter((v): v is string => typeof v === 'string')

  if (equipmentIdsToCreate.length > 0) {
    const { data: priors } = await supabase
      .from('pm_tickets')
      .select('equipment_id, month, year, status')
      .in('equipment_id', equipmentIdsToCreate)
      .in('status', ['unassigned', 'assigned', 'in_progress'])
      .is('deleted_at', null)
      .or(`year.lt.${year},and(year.eq.${year},month.lt.${month})`)
      .order('year', { ascending: false })
      .order('month', { ascending: false })

    const priorByEquipment = new Map<string, { month: number; year: number; status: string }>()
    for (const p of priors ?? []) {
      if (!p.equipment_id) continue
      if (!priorByEquipment.has(p.equipment_id)) {
        priorByEquipment.set(p.equipment_id, { month: p.month, year: p.year, status: p.status })
      }
    }

    for (const t of ticketsToCreate) {
      if (!t.equipment_id) continue
      if (t.requires_review) continue // already flagged (credit-hold) — don't clobber reason
      const prior = priorByEquipment.get(t.equipment_id)
      if (prior) {
        t.requires_review = true
        t.review_reason = `Prior PM ${prior.month}/${prior.year} still ${prior.status}`
      }
    }
  }

  const flaggedCount = ticketsToCreate.filter((t) => t.requires_review === true).length

  // In skip mode, validate skipCreditHoldCustomerIds against credit-hold-eligible
  // customers actually seen this run. Preserves the original API guarantee that
  // the modal can't be used to suppress non-credit-hold customers.
  if (creditHoldReviewMode === 'skip' && !preview) {
    for (const cid of skipCreditHoldSet) {
      if (!creditHoldCustomers.has(cid)) {
        throw new Error(`Customer ${cid} is not on credit hold`)
      }
    }
  }

  if (preview) {
    return {
      created: [],
      attempted: ticketsToCreate.length,
      skipped,
      skippedCreditHold,
      flaggedCount,
      creditHoldCustomers: Array.from(creditHoldCustomers.values()),
    }
  }

  let created: PmTicketRow[] = []
  if (ticketsToCreate.length > 0) {
    const { data: insertedTickets, error: insertError } = await supabase
      .from('pm_tickets')
      .upsert(ticketsToCreate, {
        onConflict: 'pm_schedule_id,month,year',
        ignoreDuplicates: true,
      })
      .select()
    if (insertError) throw insertError
    created = insertedTickets ?? []
  }

  return {
    created,
    attempted: ticketsToCreate.length,
    skipped,
    skippedCreditHold,
    flaggedCount,
    creditHoldCustomers: Array.from(creditHoldCustomers.values()),
  }
}
