import { createClient } from '@/lib/supabase/server'

const RATE_TYPE_KEY: Record<string, string> = {
  standard:   'labor_rate_per_hour',
  industrial: 'industrial_labor_rate_per_hour',
  vacuum:     'vacuum_labor_rate_per_hour',
}

export async function getLaborRate(type: string): Promise<number> {
  const key = RATE_TYPE_KEY[type] ?? RATE_TYPE_KEY.standard
  const val = await getSetting(key)
  const n = parseFloat(val ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 75
}

// Per-customer override columns, keyed by labor_rate_type (migration 088).
const RATE_TYPE_CUSTOMER_COLUMN: Record<string, string> = {
  standard:   'special_labor_rate_standard',
  industrial: 'special_labor_rate_industrial',
  vacuum:     'special_labor_rate_vacuum',
}

// Effective labor rate for a customer + rate type: returns the customer's
// negotiated/bid override when set, otherwise falls back to the global rate.
// Use this anywhere the result feeds what the CUSTOMER is billed. Internal
// tech-payout math (ACE labor) must keep calling getLaborRate directly.
export async function getCustomerLaborRate(
  customerId: number | null | undefined,
  type: string,
): Promise<number> {
  if (customerId != null) {
    const col = RATE_TYPE_CUSTOMER_COLUMN[type] ?? RATE_TYPE_CUSTOMER_COLUMN.standard
    const supabase = await createClient()
    const { data } = await supabase
      .from('customers')
      .select(col)
      .eq('id', customerId)
      .maybeSingle()
    const v = (data as Record<string, unknown> | null)?.[col]
    // 0 (and null) means "use the global rate" — only a positive override wins.
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  }
  return getLaborRate(type)
}

// Per-trip trip-charge RATE — a dollar amount, like the labor rate. Falls back
// to 0 (feature off until a rate is set in Settings). Billed trip charge is this
// rate × the per-ticket trip count (see effectiveTripChargeQty).
export async function getTripChargeRate(): Promise<number> {
  const val = await getSetting('trip_charge_amount')
  const n = parseFloat(val ?? '')
  return Number.isFinite(n) && n >= 0 ? n : 0
}

// Number of trips billed on a SERVICE ticket (mirrors labor hours). One rule,
// used in every service billing path so the on-screen total and the stored
// billing_amount agree:
//   - An explicit per-ticket qty (including 0) always wins.
//   - Service tickets dropped off at the shop ('inside') default to 0 trips.
//   - Field service ('outside') defaults to 1 trip.
// PM tickets do NOT flow through this helper: they're flat-rate under agreement
// and default to 0 trips in the PM complete route (feedback #36).
export function effectiveTripChargeQty(
  ticketQty: number | null | undefined,
  ticketType: string | null | undefined,
): number {
  if (ticketQty != null) return ticketQty
  if (ticketType === 'inside') return 0
  return 1
}

export async function getSetting(key: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // not found
    throw error
  }
  return data.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  if (error) throw error
}
