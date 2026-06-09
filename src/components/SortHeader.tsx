'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDir } from '@/lib/hooks/useSortableTable'

/**
 * Clickable table header that drives a `useSortableTable` hook. Renders a
 * neutral ↕ until its column is active, then ↑/↓ for the direction, and sets
 * `aria-sort` for screen readers.
 *
 * `className` controls the `<th>` padding/typography so each table can keep
 * its own header style; pass the same classes the page's plain `<th>`s use.
 */
export default function SortHeader<K extends string>({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  className = 'px-4 py-3 font-medium text-gray-600 dark:text-gray-400',
  align = 'left',
}: {
  label: string
  colKey: K
  sortKey: K | null
  sortDir: SortDir
  onSort: (key: K) => void
  className?: string
  align?: 'left' | 'right'
}) {
  const active = sortKey === colKey
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-gray-800 dark:text-gray-200' : ''}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" aria-hidden="true" />
      </button>
    </th>
  )
}
