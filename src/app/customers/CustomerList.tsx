'use client'

import { useState, useEffect, useRef } from 'react'
import { Users } from 'lucide-react'
import { CustomerRow } from '@/types/database'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import FilterBar from '@/components/ui/FilterBar'
import DataTable, { type DataTableColumn } from '@/components/ui/DataTable'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'
import { CUSTOMER_LIST_COLUMNS, CUSTOMER_LIST_LIMIT } from '@/lib/db/customer-list'

interface CustomerListProps {
  customers: CustomerRow[]
  initialTotal: number
  initialSearch: string
}

const CUSTOMER_COLUMNS: DataTableColumn<CustomerRow>[] = [
  {
    key: 'account',
    header: 'Account #',
    sortValue: (c) => c.account_number,
    className: 'font-mono text-xs',
    render: (c) => c.account_number ?? '—',
  },
  {
    key: 'name',
    header: 'Customer Name',
    sortValue: (c) => c.name,
    cardPrimary: true,
    className: 'text-gray-900 dark:text-white font-medium',
    render: (c) => c.name,
  },
  {
    key: 'ar_terms',
    header: 'AR Terms',
    sortValue: (c) => c.ar_terms,
    render: (c) => c.ar_terms ?? '—',
  },
  {
    key: 'status',
    header: 'Status',
    sortValue: (c) => (c.credit_hold ? 1 : 0),
    cardLabel: '', // badge, no "Status:" prefix on mobile
    render: (c) => (c.credit_hold ? <CreditHoldBadge /> : null),
  },
]

export default function CustomerList({ customers, initialTotal, initialSearch }: CustomerListProps) {
  // Search term lives in the URL so the Back button restores it.
  const { filters, set } = useUrlFilters({ q: initialSearch })
  const search = filters.q
  const [displayedCustomers, setDisplayedCustomers] = useState<CustomerRow[]>(customers)
  const [totalMatches, setTotalMatches] = useState(initialTotal)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = search.trim()

    // Clearing the search fires on the same tick as a real query, so route it through
    // the same setTimeout callback (0ms) rather than setting state directly in the
    // effect body — keeps every state update on this path inside one callback.
    debounceRef.current = setTimeout(async () => {
      if (!trimmed) {
        setDisplayedCustomers(customers)
        setTotalMatches(initialTotal)
        setSearching(false)
        return
      }

      setSearching(true)
      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(trimmed)
      const { data, count } = await supabase
        .from('customers')
        .select(CUSTOMER_LIST_COLUMNS, { count: 'exact' })
        .eq('active', true)
        .or(safeOrRaw([
          { column: 'name', op: 'ilike', raw: `%${q}%` },
          { column: 'account_number', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('name')
        .limit(CUSTOMER_LIST_LIMIT)
      setDisplayedCustomers((data ?? []) as unknown as typeof customers)
      setTotalMatches(count ?? (data ?? []).length)
      setSearching(false)
    }, trimmed ? 300 : 0)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, customers, initialTotal])

  const truncated = totalMatches > displayedCustomers.length

  return (
    <>
      <FilterBar
        search={{
          value: search,
          onChange: (v) => set('q', v, { debounce: true }),
          placeholder: 'Search by customer name or account number...',
        }}
      />
      {(searching || truncated) && (
        <p className="text-sm">
          {searching && <span className="text-gray-400 dark:text-gray-500">Searching...</span>}
          {!searching && truncated && (
            <span className="text-amber-600 dark:text-amber-400">
              Showing first {displayedCustomers.length} of {totalMatches.toLocaleString()}
              {search.trim() ? ' matches — refine your search' : ' — search to find others'}
            </span>
          )}
        </p>
      )}

      <DataTable
        rows={displayedCustomers}
        columns={CUSTOMER_COLUMNS}
        rowKey={(c) => String(c.id)}
        rowHref={(c) => `/customers/${c.id}`}
        rowAriaLabel={(c) => `View ${c.name}`}
        empty={<EmptyState icon={Users} message={emptyCopy('customers', Boolean(search.trim()))} />}
      />
    </>
  )
}
