'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, PackageCheck } from 'lucide-react'
import PartsStatusBadge from '@/components/PartsStatusBadge'
import { ticketDeepLink } from '@/lib/parts-queue'
import { partLabel } from '@/lib/parts'
import type { MyPartRow, MyPartStatus } from '@/lib/db/parts-queue'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

type Props = {
  rows: MyPartRow[]
  initialTab: string
}

const VALID_TABS: MyPartStatus[] = ['received', 'from_stock', 'ordered', 'requested', 'pending_review']

const TABS: { key: MyPartStatus; label: string }[] = [
  { key: 'received', label: 'Ready for Pickup' },
  { key: 'from_stock', label: 'From Stock' },
  { key: 'ordered', label: 'On Order' },
  { key: 'requested', label: 'Awaiting Order' },
  { key: 'pending_review', label: 'Pending Review' },
]

const EMPTY_COPY: Record<MyPartStatus, string> = {
  received: 'No parts are ready for pickup right now.',
  from_stock: 'No parts are being pulled from stock.',
  ordered: 'No parts are currently on order.',
  requested: 'No parts are awaiting an order.',
  pending_review: 'No parts are awaiting office review.',
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString()
}

// The date that matters depends on where the part is in its lifecycle.
function rowDate(row: MyPartRow): string | null {
  if (row.status === 'received') return row.received_at
  if (row.status === 'from_stock') return row.triaged_at
  if (row.status === 'ordered') return row.ordered_at
  return row.requested_at
}

function dateColumnLabel(status: MyPartStatus): string {
  if (status === 'received') return 'Received'
  if (status === 'from_stock') return 'Pulled'
  if (status === 'ordered') return 'Ordered'
  return 'Requested'
}

function rowKey(row: MyPartRow): string {
  return `${row.source}:${row.ticket_id}:${row.part_index}`
}

// "Make Model — S/N 12345", trimmed to whatever pieces are present.
function machineLabel(row: MyPartRow): string {
  const head = [row.machine_make, row.machine_model].filter(Boolean).join(' ')
  const sn = row.machine_serial ? `S/N ${row.machine_serial}` : ''
  return [head, sn].filter(Boolean).join(' — ')
}

export default function MyPartsClient({ rows, initialTab }: Props) {
  const router = useRouter()
  // Active tab lives in the URL so Back from a ticket restores it.
  const { filters, set } = useUrlFilters({
    tab: VALID_TABS.includes(initialTab as MyPartStatus) ? initialTab : '',
  })
  const active: MyPartStatus = (filters.tab || 'received') as MyPartStatus

  const byStatus = useMemo(() => {
    const buckets: Record<MyPartStatus, MyPartRow[]> = {
      received: [],
      from_stock: [],
      ordered: [],
      requested: [],
      pending_review: [],
    }
    for (const row of rows) buckets[row.status].push(row)
    // Most recent first within each tab.
    for (const key of Object.keys(buckets) as MyPartStatus[]) {
      buckets[key].sort((a, b) => (rowDate(b) ?? '').localeCompare(rowDate(a) ?? ''))
    }
    return buckets
  }, [rows])

  const visible = byStatus[active]
  const dateLabel = dateColumnLabel(active)

  return (
    <div className="space-y-6">
      {/* Status tabs — Ready for Pickup is the most actionable, so it leads. */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-2">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter parts by status">
          {TABS.map((tab) => {
            const isActive = active === tab.key
            const count = byStatus[tab.key].length
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => set('tab', tab.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors min-h-[44px] lg:min-h-0 ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {tab.label}
                <span
                  className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] text-xs font-semibold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <PackageCheck className="h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{EMPTY_COPY[active]}</p>
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {visible.map((row) => (
                <div
                  key={rowKey(row)}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(ticketDeepLink(row.source, row.ticket_id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      router.push(ticketDeepLink(row.source, row.ticket_id))
                    }
                  }}
                  className="px-4 py-3 cursor-pointer active:bg-gray-50 dark:active:bg-gray-700"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {partLabel(row) || '—'}
                      {row.quantity != null && (
                        <span className="text-gray-500 dark:text-gray-400 font-normal"> × {row.quantity}</span>
                      )}
                    </p>
                    <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <PartsStatusBadge status={row.status} />
                    {row.work_order_number != null && (
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        WO-{row.work_order_number}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{row.customer_name || '—'}</p>
                  {machineLabel(row) && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{machineLabel(row)}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {row.vendor ? `${row.vendor} · ` : ''}
                    {row.unit_price != null ? `$${row.unit_price.toFixed(2)} · ` : ''}
                    {dateLabel}: {fmtDate(rowDate(row))}
                  </p>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-2.5">Part</th>
                    <th className="px-4 py-2.5">Machine</th>
                    <th className="px-4 py-2.5">Qty</th>
                    <th className="px-4 py-2.5">Price</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Customer</th>
                    <th className="px-4 py-2.5">WO #</th>
                    <th className="px-4 py-2.5">Vendor</th>
                    <th className="px-4 py-2.5">{dateLabel}</th>
                    <th className="px-4 py-2.5" aria-label="Open ticket"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visible.map((row) => (
                    <tr
                      key={rowKey(row)}
                      onClick={() => router.push(ticketDeepLink(row.source, row.ticket_id))}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {partLabel(row) || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {machineLabel(row) || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums">
                        {row.quantity ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 tabular-nums whitespace-nowrap">
                        {row.unit_price == null ? '—' : `$${row.unit_price.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-3">
                        <PartsStatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {row.customer_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {row.work_order_number != null ? `WO-${row.work_order_number}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.vendor || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {fmtDate(rowDate(row))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
