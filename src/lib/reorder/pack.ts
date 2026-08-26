// Pack-size parsing and buying-UOM rounding for the reorder module.
// Synergy stores `prod.PackSize` as free text ("12/CS", "10EA/PK"); we parse
// out the eaches-per-buying-UOM number so quantities can be rounded up to
// whole cases/packs when suggesting an order qty.

/**
 * Parse a Synergy `PackSize` string into eaches-per-buying-UOM.
 * "12/CS" -> 12, "4/CS" -> 4, "10EA/PK" -> 10. null, "EACH", empty, or any
 * unparseable/zero value falls back to 1 (treat as each) — never returns 0,
 * since callers divide by this.
 */
export function parsePackQty(packSize: string | null): number {
  if (!packSize) return 1

  const match = packSize.match(/^(\d+)/)
  if (!match) return 1

  const qty = parseInt(match[1], 10)
  if (!Number.isFinite(qty) || qty <= 0) return 1

  return qty
}

/**
 * Round a quantity in eaches up to a whole count of the buying UOM (case/pack).
 * `packQty` falsy (0, NaN, undefined) is treated as 1 (no rounding). Negative
 * `eaches` (nothing to order) returns 0.
 */
export function roundUpToPack(eaches: number, packQty: number): number {
  if (eaches < 0) return 0
  const pack = packQty || 1
  return Math.ceil(eaches / pack)
}
