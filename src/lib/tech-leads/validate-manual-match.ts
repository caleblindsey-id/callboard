import type { EquipmentSaleTier } from '@/types/database'
import { EQUIPMENT_SALE_TIERS } from './bonus-tiers'

// Validation + normalization for the manual-match route
// (POST /api/tech-leads/[id]/manual-match). Pure — no DB — so it's unit-testable
// and shared. A manager uses this to attach a known Synergy sale order to an
// approved equipment-sale lead and earn it on demand, instead of waiting for the
// nightly scan (feedback #74).
//
// The candidate table requires both synergy_order_number and synergy_order_date
// (NOT NULL), so both are required here. Total is optional.

const VALID_TIERS = Object.keys(EQUIPMENT_SALE_TIERS) as EquipmentSaleTier[]
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

export type ManualMatchInput = {
  synergy_order_number?: unknown
  synergy_order_date?: unknown
  synergy_order_total?: unknown
  tier?: unknown
}

export type ManualMatchFields = {
  synergy_order_number: number
  synergy_order_date: string
  synergy_order_total: number | null
  tier: EquipmentSaleTier
  bonus_amount: number
}

export type ManualMatchResult =
  | { ok: true; fields: ManualMatchFields }
  | { ok: false; error: string }

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim())
    return Number.isNaN(n) ? null : n
  }
  return null
}

export function validateManualMatch(body: ManualMatchInput): ManualMatchResult {
  const orderNumber = toNumber(body.synergy_order_number)
  if (orderNumber === null || !Number.isInteger(orderNumber) || orderNumber <= 0) {
    return { ok: false, error: 'Enter a valid Synergy order number.' }
  }

  const orderDate = typeof body.synergy_order_date === 'string' ? body.synergy_order_date.trim() : ''
  if (!DATE_SHAPE.test(orderDate) || Number.isNaN(new Date(orderDate + 'T12:00:00Z').getTime())) {
    return { ok: false, error: 'Enter a valid order date (YYYY-MM-DD).' }
  }

  const tier = body.tier
  if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as EquipmentSaleTier)) {
    return { ok: false, error: 'A valid equipment tier is required.' }
  }

  let total: number | null = null
  if (body.synergy_order_total != null && body.synergy_order_total !== '') {
    const t = toNumber(body.synergy_order_total)
    if (t === null || !Number.isFinite(t) || t < 0) {
      return { ok: false, error: 'Order total must be a non-negative number.' }
    }
    total = t
  }

  return {
    ok: true,
    fields: {
      synergy_order_number: orderNumber,
      synergy_order_date: orderDate,
      synergy_order_total: total,
      tier: tier as EquipmentSaleTier,
      bonus_amount: EQUIPMENT_SALE_TIERS[tier as EquipmentSaleTier].amount,
    },
  }
}
