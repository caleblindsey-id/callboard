'use client'

import { useDeferredValue, useMemo } from 'react'
import Link from 'next/link'
import { ChevronRight, Wrench } from 'lucide-react'
import type { TechEquipmentItem } from './page'
import { formatDate } from '@/lib/format'
import { daysOverdue } from '@/lib/overdue'
import ScrollableTable from '@/components/ScrollableTable'
import FilterBar from '@/components/ui/FilterBar'
import RowLink from '@/components/ui/RowLink'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import { OverdueBadge } from '@/components/StatusBadge'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

interface TechEquipmentListProps {
  equipment: TechEquipmentItem[]
  // Seeded server-side from searchParams (mirrors EquipmentList.tsx / MyPartsClient)
  // so the URL is the source of truth on mount — a client useSearchParams() here
  // would trip the Suspense/CSR-bailout build error.
  initialSearch: string
}

type ServiceBucket = 'overdue' | 'due' | 'future' | 'none'

function classifyNextService(dateStr: string | null): {
  text: string
  className: string
  bucket: ServiceBucket
  // Days past due — 0 unless bucket is 'overdue'. Feeds the shared
  // OverdueBadge (src/components/StatusBadge.tsx), which owns the label/
  // day-count rendering; this function only decides whether it's overdue.
  days: number
} {
  if (!dateStr) {
    return { text: '—', className: 'text-gray-400 dark:text-gray-600', bucket: 'none', days: 0 }
  }

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
    return {
      text: label,
      className: 'text-red-600 dark:text-red-400 font-medium',
      bucket: 'overdue',
      days: daysOverdue({ month, year }),
    }
  }
  if (year === currentYear && month === currentMonth) {
    return {
      text: label,
      className: 'text-amber-600 dark:text-amber-400 font-medium',
      bucket: 'due',
      days: 0,
    }
  }
  return {
    text: label,
    className: 'text-gray-600 dark:text-gray-400',
    bucket: 'future',
    days: 0,
  }
}

const BUCKET_ORDER: Record<ServiceBucket, number> = {
  overdue: 0,
  due: 1,
  future: 2,
  none: 3,
}

export default function TechEquipmentList({ equipment, initialSearch }: TechEquipmentListProps) {
  // Search lives in the URL so drill-in-then-Back restores the typed search
  // (mirrors EquipmentList.tsx / MyPartsClient's tab sync).
  const { filters, set } = useUrlFilters({ q: initialSearch })
  const search = filters.q
  const deferredSearch = useDeferredValue(search)

  const filtered = useMemo(() => {
    const base = !deferredSearch
      ? equipment
      : equipment.filter((e) => {
          const q = deferredSearch.toLowerCase()
          const name = e.customers?.name?.toLowerCase() ?? ''
          const serial = e.serial_number?.toLowerCase() ?? ''
          return name.includes(q) || serial.includes(q)
        })

    // Sort: overdue first, then due-this-month, then future, then no schedule.
    // Within the same bucket, earlier next-service-date first; tiebreak by customer.
    return [...base].sort((a, b) => {
      const aInfo = classifyNextService(a.nextServiceDate)
      const bInfo = classifyNextService(b.nextServiceDate)
      const bucketDelta = BUCKET_ORDER[aInfo.bucket] - BUCKET_ORDER[bInfo.bucket]
      if (bucketDelta !== 0) return bucketDelta
      if (a.nextServiceDate && b.nextServiceDate && a.nextServiceDate !== b.nextServiceDate) {
        return a.nextServiceDate.localeCompare(b.nextServiceDate)
      }
      return (a.customers?.name ?? '').localeCompare(b.customers?.name ?? '')
    })
  }, [equipment, deferredSearch])

  return (
    <>
      <FilterBar
        search={{
          value: search,
          onChange: (v) => set('q', v, { debounce: true }),
          placeholder: 'Search by customer or serial...',
        }}
      />

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Wrench}
            message={
              equipment.length === 0
                ? "No equipment yet — once you're assigned to a PM or service ticket, the equipment will appear here."
                : emptyCopy('equipment', true)
            }
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((e) => {
                const next = classifyNextService(e.nextServiceDate)
                return (
                  <Link
                    key={e.id}
                    href={`/equipment/${e.id}`}
                    className="block px-4 py-3 min-h-[44px] active:bg-gray-50 dark:active:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-inset"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {e.customers?.name ?? '—'}
                        </span>
                        {next.bucket === 'overdue' && <OverdueBadge days={next.days} />}
                      </div>
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
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Last: {formatDate(e.lastServiceDate)} · Next:{' '}
                      <span className={next.className}>{next.text}</span>
                    </p>
                  </Link>
                )
              })}
            </div>

            {/* Desktop table */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Make / Model</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Serial Number</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Last Service</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Next Service</th>
                    <th className="px-3 py-3 w-8" aria-label="Open equipment"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((e) => {
                    const next = classifyNextService(e.nextServiceDate)
                    return (
                      <tr key={e.id} className="relative hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-5 py-3 text-gray-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <span>{e.customers?.name ?? '—'}</span>
                            {next.bucket === 'overdue' && <OverdueBadge days={next.days} />}
                          </div>
                          <RowLink href={`/equipment/${e.id}`} label={`View equipment for ${e.customers?.name ?? 'this record'}`} />
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
                        <td className="px-3 py-3">
                          <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>
    </>
  )
}
