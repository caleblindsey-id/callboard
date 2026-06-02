'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'

/**
 * Shape returned by the products combobox search.
 * Matches the prior inline interfaces in AddEquipmentModal and
 * the equipment detail DefaultProductsSection.
 */
export interface ProductSearchResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
  synced_at: string | null
  // Primary vendor + vendor part # from Synergy (migration 091). Used to prefill
  // a service-ticket part request when a stock item is picked. Never includes
  // unit_cost — that stays server-only.
  vendor_code: number | null
  vendor: string | null
  vendor_item_code: string | null
}

export interface UseProductSearchReturn {
  /** Current search input value. */
  query: string
  /** Update the search input. Triggers a debounced fetch. */
  setQuery: (value: string) => void
  /** Latest debounced query string used for the most recent fetch. */
  debouncedQuery: string
  /** Latest result set from the products table. */
  results: ProductSearchResult[]
  /** True while the debounced fetch is in flight. */
  loading: boolean
  /** True when the combobox dropdown should be visible. */
  comboOpen: boolean
  /** Manually open/close the combobox dropdown (e.g. on input focus). */
  setComboOpen: (open: boolean) => void
  /** Reset the input + results + dropdown state. Call after picking a product. */
  clear: () => void
}

/**
 * Debounced product search hook. Extracted from AddEquipmentModal and
 * DefaultProductsSection — both previously hand-rolled the same debounce
 * + supabase query + PostgREST-OR-injection guard.
 *
 * Behavior contract (must match the prior inline implementations):
 *   - Empty/whitespace query => clear results, close dropdown
 *   - Non-empty query => 300ms debounce, then fetch up to `limit` products
 *     (default 25) matching `number ilike` or `description ilike`
 *   - Strip `,` `(` `)` from the query before splicing into `.or()`
 *   - On fetch resolution, open the dropdown (regardless of result count)
 */
export function useProductSearch(options?: { limit?: number }): UseProductSearchReturn {
  const limit = options?.limit ?? 25
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setComboOpen(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(query.trim())
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description, unit_price, synced_at, vendor_code, vendor, vendor_item_code')
        .or(safeOrRaw([
          { column: 'number', op: 'ilike', raw: `%${q}%` },
          { column: 'description', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('number')
        .limit(limit)
        .returns<ProductSearchResult[]>()
      setResults(data ?? [])
      setDebouncedQuery(q)
      setComboOpen(true)
      setLoading(false)
    }, 300)
  }, [query, limit])

  function clear() {
    setQuery('')
    setResults([])
    setComboOpen(false)
  }

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    loading,
    comboOpen,
    setComboOpen,
    clear,
  }
}
