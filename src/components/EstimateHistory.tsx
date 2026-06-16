'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { EquipmentEstimateLogRow } from '@/types/database'

interface EstimateHistoryProps {
  items: EquipmentEstimateLogRow[]
  collapsible?: boolean
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === 'declined') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        Declined
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      {outcome}
    </span>
  )
}

// Permanent estimate snapshots for a unit (migration 117). Distinct from the
// Service History card: that shows completed/billed WORK; this shows estimates
// that did NOT become work (declined), so when a unit comes back staff can see
// what was quoted before and why it was rejected. Mobile-first — techs view this.
export default function EstimateHistory({ items, collapsible = false }: EstimateHistoryProps) {
  const [expanded, setExpanded] = useState(!collapsible)

  const header = (
    <div
      className={`px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between ${collapsible ? 'cursor-pointer select-none' : ''}`}
      onClick={collapsible ? () => setExpanded(!expanded) : undefined}
    >
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
        Past Estimates ({items.length})
      </h2>
      {collapsible && (
        expanded
          ? <ChevronDown className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          : <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
      )}
    </div>
  )

  if (items.length === 0) {
    return null
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      {header}
      {expanded && (
        <>
          {/* Mobile cards */}
          <div className="divide-y divide-gray-100 dark:divide-gray-700 md:hidden">
            {items.map((e) => (
              <div key={e.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {e.service_ticket_id ? (
                      <Link
                        href={`/service/${e.service_ticket_id}`}
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {e.work_order_number ? `WO-${e.work_order_number}` : 'Estimate'}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-900 dark:text-white">
                        {e.work_order_number ? `WO-${e.work_order_number}` : 'Estimate'}
                      </span>
                    )}
                    <OutcomeBadge outcome={e.outcome} />
                  </div>
                  {e.estimate_amount != null && (
                    <span className="font-medium text-gray-900 dark:text-white">
                      ${e.estimate_amount.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <div>{new Date(e.created_at).toLocaleDateString()}</div>
                  {e.problem_description && (
                    <div className="text-gray-700 dark:text-gray-300">{e.problem_description}</div>
                  )}
                  {e.decline_reason && (
                    <div className="text-red-600 dark:text-red-400 italic">
                      Declined: {e.decline_reason}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">WO #</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Outcome</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Amount</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-600 dark:text-gray-400">What it was for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 align-top">
                    <td className="px-5 py-3">
                      {e.service_ticket_id ? (
                        <Link
                          href={`/service/${e.service_ticket_id}`}
                          className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                        >
                          {e.work_order_number ? `WO-${e.work_order_number}` : '—'}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900 dark:text-white">
                          {e.work_order_number ? `WO-${e.work_order_number}` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3">
                      <OutcomeBadge outcome={e.outcome} />
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {e.estimate_amount != null ? `$${e.estimate_amount.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 dark:text-gray-400 max-w-md">
                      {e.problem_description || '—'}
                      {e.decline_reason && (
                        <div className="text-red-600 dark:text-red-400 italic mt-1">
                          Declined: {e.decline_reason}
                        </div>
                      )}
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
