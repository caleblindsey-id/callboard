'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { CustomerRow } from '@/types/database'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import { createClient } from '@/lib/supabase/client'

interface CustomerListProps {
  customers: CustomerRow[]
}

export default function CustomerList({ customers }: CustomerListProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [displayedCustomers, setDisplayedCustomers] = useState<CustomerRow[]>(customers)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!search.trim()) {
      setDisplayedCustomers(customers)
      setSearching(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      const q = search.trim()
      const { data } = await supabase
        .from('customers')
        .select('*')
        .or(`name.ilike.%${q}%,account_number.ilike.%${q}%`)
        .order('name')
        .limit(50)
      setDisplayedCustomers(data ?? [])
      setSearching(false)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, customers])

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by customer name or account number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        {searching && (
          <span className="text-sm text-gray-400 dark:text-gray-500 shrink-0">Searching...</span>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {displayedCustomers.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No customers found.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {displayedCustomers.map((c) => (
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
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Account #</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer Name</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">AR Terms</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {displayedCustomers.map((c) => (
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
                          className="text-sm font-medium text-slate-700 hover:text-slate-900"
                        >
                          View
                        </button>
                      </td>
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
