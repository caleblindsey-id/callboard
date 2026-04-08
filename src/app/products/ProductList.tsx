'use client'

import { useState } from 'react'
import { ProductRow } from '@/types/database'

interface ProductListProps {
  products: ProductRow[]
}

function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProductList({ products }: ProductListProps) {
  const [search, setSearch] = useState('')

  const filtered = products.filter((p) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.number.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <input
          type="text"
          placeholder="Search by product number or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No products found.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((p) => (
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
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">#</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Description</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Unit Price</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Last Synced</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((p) => (
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
