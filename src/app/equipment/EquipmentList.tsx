'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { EquipmentWithCustomer } from '@/lib/db/equipment'
import AddEquipmentModal from './AddEquipmentModal'

interface EquipmentListProps {
  equipment: EquipmentWithCustomer[]
}

export default function EquipmentList({ equipment }: EquipmentListProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = equipment.filter((e) => {
    if (showActive && !e.active) return false
    if (!showActive && e.active) return false
    if (search) {
      const q = search.toLowerCase()
      const name = e.customers?.name?.toLowerCase() ?? ''
      const serial = e.serial_number?.toLowerCase() ?? ''
      return name.includes(q) || serial.includes(q)
    }
    return true
  })

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
              {filtered.map((e) => (
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
                  <div className="flex items-center gap-2 mt-1">
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
                </div>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Make / Model</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Serial Number</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Location</th>
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((e) => (
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
                  ))}
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
