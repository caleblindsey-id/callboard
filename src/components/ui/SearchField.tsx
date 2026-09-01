'use client'

import { Search, X } from 'lucide-react'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Field label above the input. */
  label?: string
  /** Wrapper width/spacing. Defaults to the `FilterBar` sizing. */
  className?: string
}

/**
 * The standard labeled free-text search input: magnifier on the left, a clear
 * button on the right once there's a query. Extracted from `FilterBar` (which
 * still renders it for its own `search` prop) so cards that own their filter
 * row directly — the billing Invoiced archive, for one — get the identical
 * control instead of a near-copy of the markup.
 *
 * Purely presentational: the caller owns the query state and the filtering
 * (pair with `matchesSearch` from src/lib/search.ts).
 */
export default function SearchField({
  value,
  onChange,
  placeholder,
  label = 'Search',
  className = 'w-full lg:w-64',
}: SearchFieldProps) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
        <input
          type="search"
          inputMode="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 pl-8 pr-8 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
