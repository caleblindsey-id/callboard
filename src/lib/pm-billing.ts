import type { SupabaseClient } from '@supabase/supabase-js'
import type { PartUsed } from '@/types/database'
import { getCustomerLaborRate, getTripChargeRate } from '@/lib/db/settings'

// Shared PM billing math. Extracted from POST /api/tickets/[id]/complete so the
// first-PM-on-site auto-completion (Create Equipment from an approved tech lead)
// bills identically and the two paths can't drift.
//
// Formula: flat_rate + (additionalHours × customer labor rate)
//          + sum(additionalParts qty × canonical unit_price) + (tripQty × trip rate)
// Result is rounded to cents to match .toFixed(2) display everywhere.

export interface ComputePmBillingParams {
  customerId: number | null
  laborRateType: string
  // Already-resolved flat rate (0 when the schedule isn't flat-rate billing).
  flatRate: number
  additionalHours: number
  // Raw additional parts; canonical prices are resolved here for any with a
  // synergy_product_id, others clamped to a non-negative unit_price.
  additionalParts: PartUsed[]
  tripQty: number
}

export interface ComputePmBillingResult {
  billingAmount: number
  finalAdditionalParts: PartUsed[]
}

export async function computePmBilling(
  supabase: SupabaseClient,
  params: ComputePmBillingParams,
): Promise<ComputePmBillingResult> {
  const { customerId, laborRateType, flatRate, additionalHours, additionalParts, tripQty } = params

  const laborRate = await getCustomerLaborRate(customerId, laborRateType)

  // Resolve canonical product prices in one query for additional parts.
  const productIds = additionalParts
    .map(p => p.synergy_product_id)
    .filter((v): v is number => typeof v === 'number')
  const priceMap = new Map<number, number>()
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('synergy_id, unit_price')
      .in('synergy_id', productIds.map(String))
    if (products) {
      for (const row of products as { synergy_id: string | number | null; unit_price: number | null }[]) {
        if (row.synergy_id != null && row.unit_price != null) {
          priceMap.set(Number(row.synergy_id), Number(row.unit_price))
        }
      }
    }
  }

  const finalAdditionalParts: PartUsed[] = additionalParts.map(p => {
    const canonical = p.synergy_product_id != null ? priceMap.get(p.synergy_product_id) : undefined
    const safePrice = canonical ?? Math.max(0, Number(p.unit_price) || 0)
    return { ...p, unit_price: safePrice }
  })

  const additionalPartsTotal = finalAdditionalParts.reduce(
    (sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0),
    0,
  )

  const tripCharge = tripQty * (await getTripChargeRate())

  const billingAmount =
    Math.round((flatRate + additionalHours * laborRate + additionalPartsTotal + tripCharge) * 100) / 100

  return { billingAmount, finalAdditionalParts }
}
