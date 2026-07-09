'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, PackageCheck } from 'lucide-react'
import PartsStatusBadge from '@/components/PartsStatusBadge'
import ScrollableTable from '@/components/ScrollableTable'
import Tabs, { type TabItem } from '@/components/ui/Tabs'
import { markPartCollected, ticketDeepLink } from '@/lib/parts-queue'
import { partLabel } from '@/lib/parts'
import type { MyPartRow, MyPartStatus } from '@/lib/db/parts-queue'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

type Props = {
  rows: MyPartRow[]
  initialTab: string
}

const VALID_TABS: MyPartStatus[] = ['received', 'from_stock', 'ordered', 'requested', 'pending_review']

// Tab wording matches status-meta's canonical parts vocabulary except
// 'received', which keeps its tech-facing "Ready for Pickup" name — that's an
// action state techs rely on, not the raw status word. Per-part badges below
// (PartsStatusBadge) render the canonical label regardless of which tab they're in.
const TABS: { key: MyPartStatus; label: string }[] = [
  { key: 'received', label: 'Ready for Pickup' },
  { key: 'from_stock', label: 'From Stock' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'requested', label: 'Requested' },
  { key: 'pending_review', label: 'In Review' },
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

// A staged part that's waited this many whole days without being picked up is
// flagged stale so it stands out from fresh ones.
const STALE_DAYS = 7

function fmtPickedUp(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// "staged N days ago" for the Ready-for-Pickup aging badge; stale once it's sat
// past STALE_DAYS.
function stagedAgo(value: string | null): { label: string; stale: boolean } | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const label =
    days <= 0 ? 'staged today' : days === 1 ? 'staged 1 day ago' : `staged ${days} days ago`
  return { label, stale: days >= STALE_DAYS }
}

// A from_stock part that's been physically pulled is staged and ready for the
// tech — so it belongs under "Ready for Pickup" alongside received parts, not in
// the "From Stock" (being-pulled) bucket. Un-pulled from_stock stays in From Stock.
function displayStatus(row: MyPartRow): MyPartStatus {
  if (row.status === 'from_stock' && row.pulled_at) return 'received'
  return row.status
}

// The date that matters depends on where the part is in its lifecycle.
function rowDate(row: MyPartRow): string | null {
  if (row.status === 'from_stock') return row.pulled_at ?? row.triaged_at
  if (row.status === 'received') return row.received_at
  if (row.status === 'ordered') return row.ordered_at
  return row.requested_at
}

function dateColumnLabel(status: MyPartStatus): string {
  if (status === 'received') return 'Ready'
  if (status === 'from_stock') return 'Decided'
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
    for (const row of rows) buckets[displayStatus(row)].push(row)
    // Most recent first within each tab.
    for (const key of Object.keys(buckets) as MyPartStatus[]) {
      buckets[key].sort((a, b) => (rowDate(b) ?? '').localeCompare(rowDate(a) ?? ''))
    }
    return buckets
  }, [rows])

  const visible = byStatus[active]
  const dateLabel = dateColumnLabel(active)

  // Pickup acknowledgment state. collectedLocal holds optimistic stamps so the
  // badge flips instantly; router.refresh() then re-pulls the server truth.
  const [collectedLocal, setCollectedLocal] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  const collectedAtFor = useCallback(
    (row: MyPartRow): string | null => collectedLocal[rowKey(row)] ?? row.collected_at,
    [collectedLocal],
  )

  const handleCollect = useCallback(
    async (row: MyPartRow) => {
      const key = rowKey(row)
      setActionError(null)
      setPending((p) => ({ ...p, [key]: true }))
      try {
        const part = await markPartCollected(row.source, row.ticket_id, row.part_index)
        setCollectedLocal((c) => ({ ...c, [key]: part.collected_at ?? new Date().toISOString() }))
        router.refresh()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not mark the part picked up.')
      } finally {
        setPending((p) => {
          const next = { ...p }
          delete next[key]
          return next
        })
      }
    },
    [router],
  )

  // Greyed "Picked up" badge once acknowledged, otherwise a Mark Picked Up button.
  const renderPickup = (row: MyPartRow) => {
    const collectedAt = collectedAtFor(row)
    if (collectedAt) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-gray-500">
          <Check className="h-3.5 w-3.5" />
          Picked up {fmtPickedUp(collectedAt)}
        </span>
      )
    }
    const isPending = !!pending[rowKey(row)]
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          handleCollect(row)
        }}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 min-h-[36px]"
      >
        {isPending ? 'Saving…' : 'Mark Picked Up'}
      </button>
    )
  }

  // "staged N days ago" — hidden once the part has been picked up.
  const renderAging = (row: MyPartRow) => {
    if (collectedAtFor(row)) return null
    const ago = stagedAgo(rowDate(row))
    if (!ago) return null
    return (
      <span
        className={`text-xs ${
          ago.stale
            ? 'text-amber-600 dark:text-amber-400 font-medium'
            : 'text-gray-500 dark:text-gray-400'
        }`}
      >
        {ago.stale ? '! ' : ''}
        {ago.label}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {actionError}
        </div>
      )}
      {/* Status tabs — Ready for Pickup is the most actionable, so it leads. */}
      <Tabs
        ariaLabel="Filter parts by status"
        active={active}
        onChange={(key) => set('tab', key)}
        tabs={TABS.map((tab): TabItem => ({
          key: tab.key,
          label: tab.label,
          count: byStatus[tab.key].length,
        }))}
      />

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
                    // Ignore key events bubbling up from the Mark Picked Up button.
                    if (e.target !== e.currentTarget) return
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
                    <PartsStatusBadge status={displayStatus(row)} />
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
                  {displayStatus(row) === 'received' && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span>{renderAging(row)}</span>
                      {renderPickup(row)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <ScrollableTable className="hidden lg:block">
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
                        <div className="flex flex-col gap-1">
                          <PartsStatusBadge status={displayStatus(row)} />
                          {displayStatus(row) === 'received' && renderAging(row)}
                        </div>
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
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {displayStatus(row) === 'received' && (
                          <span className="mr-2 align-middle">{renderPickup(row)}</span>
                        )}
                        <ChevronRight className="h-4 w-4 text-gray-400 dark:text-gray-500 inline align-middle" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>
    </div>
  )
}
