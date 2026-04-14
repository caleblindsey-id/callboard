'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import ServiceStatusBadge from '@/components/ServiceStatusBadge'
import type { ServiceHistoryItem } from '@/types/service-tickets'
import type { TicketStatus } from '@/types/database'
import type { ServiceTicketStatus } from '@/types/service-tickets'

interface ServiceHistoryProps {
  items: ServiceHistoryItem[]
  showBilling: boolean
  collapsible?: boolean
}

function TypeBadge({ type }: { type: 'pm' | 'service' }) {
  if (type === 'pm') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        PM
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      SVC
    </span>
  )
}

export default function ServiceHistory({ items, showBilling, collapsible = false }: ServiceHistoryProps) {
  const [expanded, setExpanded] = useState(!collapsible)

  const header = (
    <div
      className={`px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${collapsible ? 'cursor-pointer select-none' : ''}`}
      onClick={collapsible ? () => setExpanded(!expanded) : undefined}
    >
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
        Service History ({items.length})
      </h2>
      {collapsible && (
        expanded
          ? <ChevronDown className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          : <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
      )}
    </div>
  )

  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {header}
        {expanded && (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No service history.
          </div>
        )}
      </div>
    )
  }

  function linkFor(item: ServiceHistoryItem) {
    return item.type === 'pm' ? `/tickets/${item.id}` : `/service/${item.id}`
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      {header}
      {expanded && (
        <>
          {/* Mobile cards */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700 md:hidden">
            {items.map((t) => (
              <Link
                key={t.id}
                href={linkFor(t)}
                className="block px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {t.work_order_number ? `WO-${t.work_order_number}` : '—'}
                    </span>
                    <TypeBadge type={t.type} />
                  </div>
                  {t.type === 'pm'
                    ? <StatusBadge status={t.status as TicketStatus} />
                    : <ServiceStatusBadge status={t.status as ServiceTicketStatus} />
                  }
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</div>
                  {t.hours_worked != null && (
                    <div>
                      {t.hours_worked}h
                      {t.additional_hours_worked != null && t.additional_hours_worked > 0 && (
                        <span> + {t.additional_hours_worked}h add&apos;l</span>
                      )}
                    </div>
                  )}
                  {t.parts_count > 0 && <div>{t.parts_count} parts</div>}
                  {showBilling && t.billing_amount != null && (
                    <div className="font-medium text-gray-900 dark:text-white">${t.billing_amount.toFixed(2)}</div>
                  )}
                  {t.completion_notes && (
                    <div className="text-gray-500 dark:text-gray-400 italic line-clamp-2">{t.completion_notes}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Type</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Status</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Hours</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Parts</th>
                  {showBilling && (
                    <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Billing</th>
                  )}
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-5 py-3">
                      <Link href={linkFor(t)} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                        {t.work_order_number ? `WO-${t.work_order_number}` : '—'}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <TypeBadge type={t.type} />
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {t.date ? new Date(t.date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {t.type === 'pm'
                        ? <StatusBadge status={t.status as TicketStatus} />
                        : <ServiceStatusBadge status={t.status as ServiceTicketStatus} />
                      }
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {t.hours_worked != null ? `${t.hours_worked}` : '—'}
                      {t.additional_hours_worked != null && t.additional_hours_worked > 0
                        ? ` + ${t.additional_hours_worked}`
                        : ''}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                      {t.parts_count || '—'}
                    </td>
                    {showBilling && (
                      <td className="px-5 py-3 text-gray-600 dark:text-gray-400">
                        {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate">
                      {t.completion_notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
