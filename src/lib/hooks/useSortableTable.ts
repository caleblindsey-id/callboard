'use client'

import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'

/** Values an accessor may return. Nulls/undefined always sort last. */
export type SortValue = string | number | null | undefined

/**
 * Map of column key -> getter pulling the comparable value off a row. Getters
 * handle nested/derived fields (e.g. `(t) => t.customers?.name`) so the hook
 * works on the app's nested ticket/equipment shapes, not just flat rows.
 */
export type SortAccessors<T, K extends string> = Record<K, (row: T) => SortValue>

/**
 * Shared comparator behind every sortable table. Lifted from the original
 * parts-queue implementation so behaviour stays identical across pages:
 * nulls sort last, numbers compare numerically, and strings use a
 * numeric-aware, case-insensitive locale compare ("WO-2" before "WO-10").
 *
 * Exported on its own so it can be unit-tested without React.
 */
export function compareValues(av: SortValue, bv: SortValue, dir: SortDir): number {
  const mult = dir === 'asc' ? 1 : -1
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
  return (
    String(av).localeCompare(String(bv), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * mult
  )
}

export interface UseSortableTable<T, K extends string> {
  /** Rows in display order. Equals the input order until a header is clicked. */
  sorted: T[]
  /** Active column key, or null when unsorted. */
  sortKey: K | null
  sortDir: SortDir
  /** Click a header: same column toggles asc/desc, a new column starts asc. */
  toggleSort: (key: K) => void
}

/**
 * Generic client-side table sort. Sorting is opt-in: with no `initial` the
 * table renders in its incoming order (sortKey null) until a header is
 * clicked, so existing tables look unchanged until the user sorts them.
 */
export function useSortableTable<T, K extends string>(
  rows: T[],
  accessors: SortAccessors<T, K>,
  initial?: { key: K; dir?: SortDir },
): UseSortableTable<T, K> {
  const [sortKey, setSortKey] = useState<K | null>(initial?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(initial?.dir ?? 'asc')

  const sorted = useMemo(() => {
    if (sortKey == null) return rows
    const getter = accessors[sortKey]
    return [...rows].sort((a, b) => compareValues(getter(a), getter(b), sortDir))
  }, [rows, accessors, sortKey, sortDir])

  function toggleSort(key: K) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return { sorted, sortKey, sortDir, toggleSort }
}
