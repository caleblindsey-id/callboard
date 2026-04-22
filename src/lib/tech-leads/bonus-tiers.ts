import type { EquipmentSaleTier } from '@/types/database'

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

export const EQUIPMENT_SALE_WINDOW_DAYS = 90
