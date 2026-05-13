import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import { monthsInRange, generatePmTickets } from '@/lib/pm-generation'
import { BillingType, PmScheduleInsert } from '@/types/database'

const INTERVAL_VALUES = new Set([1, 2, 3, 4, 6, 12])
const BILLING_VALUES = new Set<BillingType>(['flat_rate', 'time_and_materials', 'contract'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Backfill is auto-skipped when the first PM date is more than this many
// calendar months in the past. Keeps old-equipment schedules from generating
// a flood of phantom tickets — users still get the schedule recorded.
const BACKFILL_RECENCY_MONTHS = 3

type ReqBody = {
  equipment_id?: string
  interval_months?: number
  anchor_month?: number
  starting_year?: number
  billing_type?: BillingType
  flat_rate?: number | null
  skip_backfill?: boolean
}

// POST /api/pm-schedules
// Creates a pm_schedules row. Auto-generates PM tickets for every
// cycle-matching month from (starting_year, anchor_month) through today,
// unless one of these gates trips:
//   - skip_backfill=true            → user opted out
//   - first PM date > 3 months old  → auto-skipped (schedule still recorded)
// The schedule insert is the source of truth; if backfill fails halfway, the
// schedule still saves and the response carries `backfill.error` so the UI
// can warn (yellow), not error (red).
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReqBody
    const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : ''
    const intervalMonths = typeof body.interval_months === 'number' ? body.interval_months : NaN
    const anchorMonth = typeof body.anchor_month === 'number' ? body.anchor_month : NaN
    const startingYear = typeof body.starting_year === 'number' ? body.starting_year : NaN
    const billingType = body.billing_type
    const flatRateRaw = body.flat_rate
    const skipBackfill = body.skip_backfill === true

    if (!equipmentId || !UUID_RE.test(equipmentId)) {
      return NextResponse.json({ error: 'A valid equipment_id is required' }, { status: 400 })
    }
    if (!INTERVAL_VALUES.has(intervalMonths)) {
      return NextResponse.json({ error: 'interval_months must be one of 1, 2, 3, 4, 6, 12' }, { status: 400 })
    }
    if (!Number.isInteger(anchorMonth) || anchorMonth < 1 || anchorMonth > 12) {
      return NextResponse.json({ error: 'anchor_month must be 1-12' }, { status: 400 })
    }
    if (!Number.isInteger(startingYear) || startingYear < 2000 || startingYear > 2100) {
      return NextResponse.json({ error: 'starting_year must be between 2000 and 2100' }, { status: 400 })
    }
    if (!billingType || !BILLING_VALUES.has(billingType)) {
      return NextResponse.json({ error: 'billing_type must be flat_rate, time_and_materials, or contract' }, { status: 400 })
    }
    const flatRate =
      billingType === 'flat_rate' && typeof flatRateRaw === 'number' && Number.isFinite(flatRateRaw)
        ? flatRateRaw
        : null

    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const insertPayload: PmScheduleInsert = {
      equipment_id: equipmentId,
      interval_months: intervalMonths,
      anchor_month: anchorMonth,
      starting_year: startingYear,
      billing_type: billingType,
      flat_rate: flatRate,
      active: true,
    }

    const { data: schedule, error: insertError } = await supabase
      .from('pm_schedules')
      .insert(insertPayload)
      .select()
      .single()

    if (insertError || !schedule) {
      console.error('pm-schedules POST: insert failed', insertError)
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to create PM schedule' },
        { status: 500 }
      )
    }

    if (skipBackfill) {
      return NextResponse.json({ schedule, backfill: { skipped_by_user: true } })
    }

    const now = new Date()
    const currentMonth = now.getMonth() + 1
    const currentYear = now.getFullYear()

    // 3-month recency gate: if the first PM date is more than
    // BACKFILL_RECENCY_MONTHS calendar months before today, skip backfill.
    // The schedule row is still saved — users can manually generate older
    // months from the Tickets board if they really want them.
    const firstPmDate = new Date(startingYear, anchorMonth - 1, 1)
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - BACKFILL_RECENCY_MONTHS)

    if (firstPmDate < cutoff) {
      return NextResponse.json({ schedule, backfill: { skipped_too_old: true } })
    }

    // firstPmDate is within the recency window. Walk from there to today,
    // collecting cycle-matching months. monthsInRange handles year boundaries
    // for the rare case where startingYear < currentYear.
    const months = monthsInRange(
      startingYear,
      anchorMonth,
      currentYear,
      currentMonth,
      anchorMonth,
      intervalMonths
    )

    if (months.length === 0) {
      return NextResponse.json({
        schedule,
        backfill: { created: 0, flagged: 0, skipped: 0, months: [] },
      })
    }

    try {
      const result = await generatePmTickets({
        supabase,
        scope: { kind: 'one_schedule', scheduleId: schedule.id, months },
        createdById: user.id,
        creditHoldReviewMode: 'flag',
      })
      return NextResponse.json({
        schedule,
        backfill: {
          created: result.created,
          flagged: result.flagged,
          skipped: result.skipped,
          months: result.monthsProcessed,
        },
      })
    } catch (backfillErr) {
      console.error('pm-schedules POST: backfill failed after schedule insert', backfillErr)
      return NextResponse.json({
        schedule,
        backfill: {
          error: backfillErr instanceof Error ? backfillErr.message : 'Backfill failed',
          created: 0,
          months,
        },
      })
    }
  } catch (err) {
    console.error('pm-schedules POST error:', err)
    return NextResponse.json({ error: 'Failed to create PM schedule' }, { status: 500 })
  }
}
