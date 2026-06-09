'use client'

import { useState, useDeferredValue, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import type { EquipmentListItem } from './page'
import AddEquipmentModal from './AddEquipmentModal'
import { formatDate } from '@/lib/format'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

interface EquipmentListProps {
  equipment: EquipmentListItem[]
}

type EquipmentSortKey =
  | 'customer'
  | 'makeModel'
  | 'serial'
  | 'location'
  | 'lastService'
  | 'nextService'
  | 'status'

const EQUIPMENT_SORT_ACCESSORS: SortAccessors<EquipmentListItem, EquipmentSortKey> = {
  customer: e => e.customers?.name,
  makeModel: e => [e.make, e.model].filter(Boolean).join(' ') || null,
  serial: e => e.serial_number,
  location: e => e.location_on_site,
  lastService: e => e.lastServiceDate,
  nextService: e => e.nextServiceDate,
  status: e => (e.active ? 0 : 1),
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

export default function EquipmentList({ equipment }: EquipmentListProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  // useDeferredValue lets React keep the input snappy on every keystroke and
  // recompute the filtered list at lower priority — input stays responsive
  // even when the equipment array is large.
  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => {
    return equipment.filter((e) => {
      if (showActive && !e.active) return false
      if (!showActive && e.active) return false
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase()
        const name = e.customers?.name?.toLowerCase() ?? ''
        const serial = e.serial_number?.toLowerCase() ?? ''
        return name.includes(q) || serial.includes(q)
      }
      return true
    })
  }, [equipment, showActive, deferredSearch])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    EquipmentListItem,
    EquipmentSortKey
  >(filtered, EQUIPMENT_SORT_ACCESSORS)

  return (
    <>
      {/* Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by customer or serial number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowActive(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                showActive
                  ? 'bg-slate-800 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setShowActive(false)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                !showActive
                  ? 'bg-slate-800 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Inactive
            </button>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
          >
            Add Equipment
          </button>
        </div>
      </div>

      {/* Equipment list */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No equipment found.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((e) => {
                const next = formatNextService(e.nextServiceDate)
                return (
                  <div
                    key={e.id}
                    className="px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700"
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
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {e.location_on_site && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{e.location_on_site}</span>
                      )}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          e.active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {e.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Last: {formatDate(e.lastServiceDate)} · Next: <span className={next.className}>{next.text}</span>
                    </p>
                  </div>
                )
              })}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Make / Model" colKey="makeModel" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Serial Number" colKey="serial" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Location" colKey="location" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Last Service" colKey="lastService" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Next Service" colKey="nextService" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                    <SortHeader label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-5 py-3 font-medium text-gray-600 dark:text-gray-400" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((e) => {
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
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              e.active
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {e.active ? 'Active' : 'Inactive'}
                          </span>
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

      <AddEquipmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
