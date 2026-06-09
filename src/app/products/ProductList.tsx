'use client'

import { useProductSearch, type ProductSearchResult } from '@/lib/hooks/useProductSearch'
import { sanitizeOrValue } from '@/lib/db/safe-or'
import { formatDate } from '@/lib/format'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

type ProductSortKey = 'number' | 'description' | 'unit_price' | 'synced_at'

const PRODUCT_SORT_ACCESSORS: SortAccessors<ProductSearchResult, ProductSortKey> = {
  number: p => p.number,
  description: p => p.description,
  unit_price: p => p.unit_price,
  synced_at: p => p.synced_at,
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

export default function ProductList() {
  const { query, setQuery, debouncedQuery, results, loading } = useProductSearch({ limit: 50 })
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ProductSearchResult,
    ProductSortKey
  >(results, PRODUCT_SORT_ACCESSORS)

  const trimmed = query.trim()
  // "Settled" = the latest fetch reflects the current input (not mid-debounce or in-flight).
  // Gate the empty/results states on this so "No products found." doesn't flash while typing.
  const settled = trimmed !== '' && !loading && debouncedQuery === sanitizeOrValue(trimmed)

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <input
          type="text"
          inputMode="search"
          placeholder="Search by product number or description..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md min-h-[44px] rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {!trimmed ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Search by item # or description to look up a product.
          </div>
        ) : !settled ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Searching…
          </div>
        ) : results.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No products found.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">{p.number}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white text-right ml-2">{formatCurrency(p.unit_price)}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{p.description ?? '—'}</p>
                </div>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <SortHeader label="#" colKey="number" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Description" colKey="description" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Unit Price" colKey="unit_price" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Last Synced" colKey="synced_at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs">{p.number}</td>
                      <td className="px-5 py-3 text-gray-900 dark:text-white">{p.description ?? '—'}</td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">{formatCurrency(p.unit_price)}</td>
                      <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(p.synced_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
