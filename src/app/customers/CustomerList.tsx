'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { CustomerRow } from '@/types/database'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import SortHeader from '@/components/SortHeader'
import ScrollableTable from '@/components/ScrollableTable'
import FilterBar from '@/components/ui/FilterBar'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'
import { CUSTOMER_LIST_COLUMNS, CUSTOMER_LIST_LIMIT } from '@/lib/db/customer-list'

interface CustomerListProps {
  customers: CustomerRow[]
  initialTotal: number
  initialSearch: string
}

type CustomerSortKey = 'account' | 'name' | 'ar_terms' | 'status'

const CUSTOMER_SORT_ACCESSORS: SortAccessors<CustomerRow, CustomerSortKey> = {
  account: c => c.account_number,
  name: c => c.name,
  ar_terms: c => c.ar_terms,
  status: c => (c.credit_hold ? 1 : 0),
}

export default function CustomerList({ customers, initialTotal, initialSearch }: CustomerListProps) {
  const router = useRouter()
  // Search term lives in the URL so the Back button restores it.
  const { filters, set } = useUrlFilters({ q: initialSearch })
  const search = filters.q
  const [displayedCustomers, setDisplayedCustomers] = useState<CustomerRow[]>(customers)
  const [totalMatches, setTotalMatches] = useState(initialTotal)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    CustomerRow,
    CustomerSortKey
  >(displayedCustomers, CUSTOMER_SORT_ACCESSORS)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!search.trim()) {
      setDisplayedCustomers(customers)
      setTotalMatches(initialTotal)
      setSearching(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(search.trim())
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
    }, 300)

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

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {displayedCustomers.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No customers found.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((c) => (
                <div
                  key={c.id}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700"
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.account_number && (
                        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
                          {c.account_number}
                        </span>
                      )}
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {c.name}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0 ml-2" />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      AR Terms: {c.ar_terms ?? '—'}
                    </span>
                    {c.credit_hold && <CreditHoldBadge />}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <SortHeader label="Account #" colKey="account" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Customer Name" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="AR Terms" colKey="ar_terms" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs">
                        {c.account_number ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-900 dark:text-white font-medium">
                        {c.name}
                      </td>
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {c.ar_terms ?? '—'}
                      </td>
                      <td className="px-5 py-3">
                        {c.credit_hold && <CreditHoldBadge />}
                      </td>
                      <td className="px-5 py-3">
                        <button
                          onClick={() => router.push(`/customers/${c.id}`)}
                          className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>
    </>
  )
}
