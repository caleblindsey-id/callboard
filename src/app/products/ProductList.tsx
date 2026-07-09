'use client'

import { Package } from 'lucide-react'
import { useProductSearch, type ProductSearchResult } from '@/lib/hooks/useProductSearch'
import { sanitizeOrValue } from '@/lib/db/safe-or'
import { formatDate } from '@/lib/format'
import FilterBar from '@/components/ui/FilterBar'
import DataTable, { type DataTableColumn } from '@/components/ui/DataTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'

function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

const PRODUCT_COLUMNS: DataTableColumn<ProductSearchResult>[] = [
  {
    key: 'number',
    header: '#',
    sortValue: (p) => p.number,
    className: 'font-mono text-xs',
    cardPrimary: true,
    render: (p) => p.number,
  },
  {
    key: 'description',
    header: 'Description',
    sortValue: (p) => p.description,
    className: 'text-gray-900 dark:text-white',
    cardLabel: '',
    render: (p) => p.description ?? '—',
  },
  {
    key: 'unit_price',
    header: 'Unit Price',
    sortValue: (p) => p.unit_price,
    cardLabel: '',
    render: (p) => formatCurrency(p.unit_price),
  },
  {
    key: 'synced_at',
    header: 'Last Synced',
    sortValue: (p) => p.synced_at,
    className: 'text-xs',
    render: (p) => formatDate(p.synced_at),
  },
]

export default function ProductList() {
  const { query, setQuery, debouncedQuery, results, loading, error } = useProductSearch({ limit: 50 })

  const trimmed = query.trim()
  // "Settled" = the latest fetch reflects the current input (not mid-debounce or in-flight).
  // Gate the empty/results states on this so "No products found." doesn't flash while typing.
  const settled = trimmed !== '' && !loading && debouncedQuery === sanitizeOrValue(trimmed)

  return (
    <>
      <FilterBar
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search by product number or description...',
        }}
      />

      {!trimmed ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Search by item # or description to look up a product.
        </div>
      ) : !settled ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Searching…
        </div>
      ) : error ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden p-8 text-center text-sm text-red-600 dark:text-red-400">
          Search failed. Check your connection and try again.
        </div>
      ) : (
        <DataTable
          rows={results}
          columns={PRODUCT_COLUMNS}
          rowKey={(p) => String(p.id)}
          empty={<EmptyState icon={Package} message={emptyCopy('products', true)} />}
        />
      )}
    </>
  )
}
