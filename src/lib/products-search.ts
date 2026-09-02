/** Minimum trimmed query length before we hit the products table.
 * Below 3 chars the pg_trgm GIN index (migration 121) cannot serve an
 * ILIKE '%q%' search, so it would sequential-scan the whole catalog. */
export const MIN_PRODUCT_SEARCH_LEN = 3

export function shouldSearchProducts(q: string): boolean {
  return q.trim().length >= MIN_PRODUCT_SEARCH_LEN
}

/** The subset of a product row the description helpers below need. */
export interface ProductDescriptionParts {
  description?: string | null
  description_1?: string | null
  description_2?: string | null
}

/**
 * Split a product's description into the primary line and the secondary
 * "Description 2" line that carries the office's item codes (feedback #96).
 *
 * Synergy has two 30-char description fields. `products.description` has always
 * stored them joined ("desc1 desc2"), and that join is NOT reversible — Desc1 is
 * variable-length, so there is no offset to split on. Migration 167 added
 * `description_1`/`description_2` so the halves can be shown separately.
 *
 * Those columns are NULL until the first products sync after 167, and Desc2 is
 * legitimately empty for plenty of products. So:
 *   - both halves present -> primary = Desc1, secondary = Desc2
 *   - otherwise           -> primary = the joined `description`, no secondary
 *
 * Never returns a secondary without a primary, and never shows the same text
 * twice (the joined `description` already contains Desc2).
 */
export function productDescriptionLines(p: ProductDescriptionParts): {
  primary: string
  secondary: string | null
} {
  const joined = (p.description ?? '').trim()
  const d1 = (p.description_1 ?? '').trim()
  const d2 = (p.description_2 ?? '').trim()
  if (d1 && d2) return { primary: d1, secondary: d2 }
  // Desc1 synced but no Desc2 on this product: prefer Desc1, which equals the
  // joined value anyway, and fall back to `description` if Desc1 came back blank.
  if (d1) return { primary: d1, secondary: null }
  return { primary: joined, secondary: null }
}

/**
 * One-line label for a product: number + description, with Desc2 kept on the
 * end. Used where a single string is required (stored snapshots, `title`
 * tooltips, CSV cells) and a two-line layout is not available.
 */
export function productLabel(p: ProductDescriptionParts & { number?: string | null }): string {
  const { primary, secondary } = productDescriptionLines(p)
  const desc = secondary ? `${primary} ${secondary}` : primary
  const number = (p.number ?? '').trim()
  if (!number) return desc
  return desc ? `${number} - ${desc}` : number
}
