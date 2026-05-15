/**
 * Static vendor suggestions for parts in the parts-queue.
 *
 * Coordinators see a "Suggested" column next to the picked Vendor as a hint
 * for who typically stocks each kind of part. The suggestion is NOT auto-
 * applied — it's purely advisory; the real vendor still has to be picked via
 * VendorPicker against the Synergy directory.
 *
 * The map is intentionally tiny and hand-curated. Tamara to refine post-merge
 * as real patterns emerge from a few weeks of queue traffic.
 *
 * Matching rules:
 *   - case-insensitive substring match against the part description
 *   - rules are evaluated in declared order — first hit wins
 *   - declared order matters because "compressor motor" should map to the
 *     compressor vendor (Air Hydraulics), not the generic motor vendor
 *     (Grainger). Keep the more specific keywords above the broader ones.
 *   - returns null when no rule matches → caller renders "—"
 */

export interface PartVendorRule {
  keywords: string[]
  vendor: string
}

export const PART_VENDOR_RULES: PartVendorRule[] = [
  // Compressor / refrigeration units → Air Hydraulics. Ordered first so
  // "compressor motor" beats the generic motor → Grainger rule below.
  {
    keywords: ['compressor', 'condensing unit', 'condenser', 'evaporator'],
    vendor: 'Air Hydraulics',
  },
  // Controls + electronics → HVAC Express
  {
    keywords: ['thermostat', 'control board', 'controller'],
    vendor: 'HVAC Express',
  },
  // General mechanicals → Grainger
  {
    keywords: ['belt', 'pulley', 'motor'],
    vendor: 'Grainger',
  },
  // Consumables Imperial Dade keeps on the shelf
  {
    keywords: ['filter', 'strainer'],
    vendor: 'Imperial Dade Stock',
  },
]

export function suggestVendor(description: string | null | undefined): string | null {
  if (!description) return null
  const haystack = description.toLowerCase()
  for (const rule of PART_VENDOR_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.vendor
    }
  }
  return null
}
