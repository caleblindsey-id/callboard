// Pure suggested-order-quantity engine for the reorder walk (usage-first —
// see the design spec's "Suggested order quantity" section). Takes only the
// narrow set of fields the math needs, not the full InvReorderRow, so it's
// independently testable and decoupled from the DB shape.

import { roundUpToPack } from './pack'

export interface SuggestQtyInput {
  qtyOnHand: number
  qtyOnPo: number
  qtyCommitted: number
  orderPoint: number
  maxStock: number
  safetyStock: number
  doNotReorder: boolean
  packQty: number
  // Trailing 4-week usage buckets, most-recent-first (Synergy UnitSlsCurYear1..13).
  periodUsage: number[]
  // Synergy's smoothed reference figures, used only when periodUsage is empty/all-zero.
  usageRate?: number | null
  demand?: number | null
}

export interface SuggestQtyOptions {
  // Weeks of supply the suggestion targets (lead time + cushion). Default 6.
  targetWeeksOfSupply?: number
  // Number of leading periodUsage buckets averaged into weeklyUsage. Default 3.
  usagePeriods?: number
}

export type ReorderUrgency = 'red' | 'amber' | 'green' | 'grey'

export interface SuggestQtyResult {
  suggestedEach: number
  suggestedCases: number
  weeklyUsage: number
  weeksOfSupply: number
  urgency: ReorderUrgency
}

export function suggestQty(input: SuggestQtyInput, opts: SuggestQtyOptions = {}): SuggestQtyResult {
  const targetWeeksOfSupply = opts.targetWeeksOfSupply ?? 6
  const usagePeriods = opts.usagePeriods ?? 3

  const weeklyUsage = computeWeeklyUsage(input.periodUsage, input.usageRate, input.demand, usagePeriods)

  const available = input.qtyOnHand + input.qtyOnPo - input.qtyCommitted

  const weeksOfSupply = weeklyUsage > 0 ? available / weeklyUsage : available > 0 ? Infinity : 0

  let suggestedEach = 0

  if (!input.doNotReorder) {
    const needTrigger =
      (input.orderPoint > 0 && available <= input.orderPoint) ||
      (weeklyUsage > 0 && weeksOfSupply < targetWeeksOfSupply)

    if (needTrigger) {
      // Usage-first: the trailing-usage cushion is the baseline target. A stored
      // max level can only RAISE the target ("order up to max"), never lower it.
      // At Whse 4 the max is rarely set and sometimes contradictory (e.g. an
      // order point above the max), so it must not drag a below-ROP item with
      // real demand down to a zero suggestion — usage stays the floor.
      const usageTarget = Math.ceil(targetWeeksOfSupply * weeklyUsage) + (input.safetyStock || 0)
      const maxTarget =
        input.maxStock > 0 && input.orderPoint > 0 && available <= input.orderPoint
          ? input.maxStock
          : 0
      const target = Math.max(usageTarget, maxTarget)
      suggestedEach = Math.max(0, target - available)
    }
  }

  const suggestedCases = roundUpToPack(suggestedEach, input.packQty)

  const urgency: ReorderUrgency =
    weeklyUsage <= 0 && available > 0
      ? 'grey'
      : available <= 0 || (input.orderPoint > 0 && available <= input.orderPoint)
        ? 'red'
        : weeksOfSupply < targetWeeksOfSupply
          ? 'amber'
          : 'green'

  return { suggestedEach, suggestedCases, weeklyUsage, weeksOfSupply, urgency }
}

function computeWeeklyUsage(
  periodUsage: number[],
  usageRate: number | null | undefined,
  demand: number | null | undefined,
  usagePeriods: number,
): number {
  const isEmptyOrAllZero = periodUsage.length === 0 || periodUsage.every((v) => v === 0)

  if (!isEmptyOrAllZero) {
    const sum = periodUsage.slice(0, usagePeriods).reduce((acc, v) => acc + v, 0)
    return sum / (usagePeriods * 4)
  }

  if (usageRate) return usageRate / 4
  if (demand) return demand / 4
  return 0
}
