/** Minimum trimmed query length before we hit the products table.
 * Below 3 chars the pg_trgm GIN index (migration 121) cannot serve an
 * ILIKE '%q%' search, so it would sequential-scan the whole catalog. */
export const MIN_PRODUCT_SEARCH_LEN = 3

export function shouldSearchProducts(q: string): boolean {
  return q.trim().length >= MIN_PRODUCT_SEARCH_LEN
}
