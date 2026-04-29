'use client'

import { useState, useDeferredValue, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type { TechEquipmentItem } from './page'

interface TechEquipmentListProps {
  equipment: TechEquipmentItem[]
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatNextService(dateStr: string | null): { text: string; className: string } {
  if (!dateStr) return { text: '—', className: 'text-gray-400 dark:text-gray-600' }

  const [yearStr, monthStr] = dateStr.split('-')
  const year = parseInt(yearStr)
  const month = parseInt(monthStr)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const label = new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { text: label, className: 'text-red-600 dark:text-red-400 font-medium' }
  }
  if (year === currentYear && month === currentMonth) {
    return { text: label, className: 'text-amber-600 dark:text-amber-400 font-medium' }
  }
  return { text: label, className: 'text-gray-600 dark:text-gray-400' }
}

export default function TechEquipmentList({ equipment }: TechEquipmentListProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  const filtered = useMemo(() => {
    if (!deferredSearch) return equipment
    const q = deferredSearch.toLowerCase()
    return equipment.filter((e) => {
      const name = e.customers?.name?.toLowerCase() ?? ''
      const serial = e.serial_number?.toLowerCase() ?? ''
      return name.includes(q) || serial.includes(q)
    })
  }, [equipment, deferredSearch])

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <input
          type="text"
          placeholder="Search by customer or serial..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[44px] lg:min-h-0 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 lg:py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {equipment.length === 0
              ? "No equipment yet — once you're assigned to a PM or service ticket, the equipment will appear here."
              : 'No equipment matches that search.'}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((e) => {
                const next = formatNextService(e.nextServiceDate)
                return (
                  <div
                    key={e.id}
                    className="px-4 py-3 min-h-[44px] cursor-pointer active:bg-gray-50 dark:active:bg-gray-700"
                    onClick={() => router.push(`/equipment/${e.id}`)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {e.customers?.name ?? '—'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {[e.make, e.model].filter(Boolean).join(' ') || '—'}
                      {e.serial_number ? ` · S/N: ${e.serial_number}` : ''}
                    </p>
                    {e.location_on_site && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {e.location_on_site}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Last: {formatDate(e.lastServiceDate)} · Next:{' '}
                      <span className={next.className}>{next.text}</span>
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Make / Model</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Serial Number</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Last Service</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Next Service</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((e) => {
                    const next = formatNextService(e.nextServiceDate)
                    return (
                      <tr
                        key={e.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                        onClick={() => router.push(`/equipment/${e.id}`)}
                      >
                        <td className="px-5 py-3 text-gray-900 dark:text-white">
                          {e.customers?.name ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {[e.make, e.model].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {e.serial_number ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {e.location_on_site ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                          {formatDate(e.lastServiceDate)}
                        </td>
                        <td className="px-5 py-3">
                          <span className={next.className}>{next.text}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
