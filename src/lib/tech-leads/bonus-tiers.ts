import type { EquipmentSaleTier } from '@/types/database'

// IMPORTANT: bonus_amount is SNAPSHOTTED on the tech_leads row at the moment a
// match is confirmed (see /api/tech-leads/[id]/candidates/[candidateId]/confirm).
// Editing the amounts below does NOT retroactively change already-earned leads —
// the stored bonus_amount on those rows is the canonical payout figure. If the
// rate card changes, leads earned after the change will use the new amount;
// leads earned before will keep their snapshotted amount. Leave a changelog note
// when adjusting these so payroll can reconcile.

export interface EquipmentSaleTierInfo {
  value: EquipmentSaleTier
  label: string
  amount: number
  note?: string
}

export const EQUIPMENT_SALE_TIERS: Record<EquipmentSaleTier, EquipmentSaleTierInfo> = {
  ride_on_scrubber:     { value: 'ride_on_scrubber',     label: 'Ride-On Scrubber',           amount: 200 },
  walk_behind_scrubber: { value: 'walk_behind_scrubber', label: 'Walk-Behind Scrubber',       amount: 100 },
  hot_water_pw:         { value: 'hot_water_pw',         label: 'Hot Water Pressure Washer',  amount: 100 },
  cold_water_pw:        { value: 'cold_water_pw',        label: 'Cold Water Pressure Washer', amount:  25 },
  cord_electric:        { value: 'cord_electric',        label: 'Cord Electric Equipment',    amount:  25,
                          note: 'Excludes vacuums, fans, and extractors under 10 gallon.' },
}

export const EQUIPMENT_SALE_TIER_LIST: EquipmentSaleTierInfo[] = [
  EQUIPMENT_SALE_TIERS.ride_on_scrubber,
  EQUIPMENT_SALE_TIERS.walk_behind_scrubber,
  EQUIPMENT_SALE_TIERS.hot_water_pw,
  EQUIPMENT_SALE_TIERS.cold_water_pw,
  EQUIPMENT_SALE_TIERS.cord_electric,
]

export function tierLabel(tier: EquipmentSaleTier | null | undefined): string {
  if (!tier) return '—'
  return EQUIPMENT_SALE_TIERS[tier]?.label ?? tier
}

export function tierAmount(tier: EquipmentSaleTier): number {
  return EQUIPMENT_SALE_TIERS[tier].amount
}

// Window a submitted equipment-sale lead stays eligible for a matching Synergy sale.
// The written plan (eff. 2022-11-01) says 12 months; Caleb set it to 6 on 2026-07-31.
// This was 90 days from launch until then, which expired leads at a quarter of the
// intended window. Stamped onto tech_leads.expires_at at INSERT, so a change here only
// affects new leads -- existing rows keep the window they were created under.
export const EQUIPMENT_SALE_WINDOW_DAYS = 180
