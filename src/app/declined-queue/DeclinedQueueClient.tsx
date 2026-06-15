'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileX } from 'lucide-react'
import type { DeclinedQueueRow } from '@/lib/db/declined-queue'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

type DeclinedSortKey = 'customer' | 'equipment' | 'amount' | 'age'

const DECLINED_SORT_ACCESSORS: SortAccessors<DeclinedQueueRow, DeclinedSortKey> = {
  customer: r => r.customer_name,
  equipment: r => r.equipment_label,
  amount: r => r.estimate_amount,
  age: r => r.days_since_declined,
}

// A declined estimate going stale is lost revenue — same tightening thresholds as
// the pending estimate queue.
function agingBadge(days: number | null): { label: string; classes: string } {
  if (days == null) return { label: '—', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 2) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 6) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  if (days <= 13) return { label, classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

function fmtMoney(amount: number | null): string {
  if (amount == null) return '—'
  return `$${amount.toFixed(2)}`
}

export default function DeclinedQueueClient({ rows }: { rows: DeclinedQueueRow[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.customer_name.toLowerCase().includes(q) ||
      r.equipment_label.toLowerCase().includes(q) ||
      (r.serial_number ?? '').toLowerCase().includes(q) ||
      String(r.work_order_number ?? '').includes(q)
    )
  }, [rows, query])

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    DeclinedQueueRow,
    DeclinedSortKey
  >(filtered, DECLINED_SORT_ACCESSORS)

  async function post(id: string, path: string, failMsg: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/service-tickets/${id}/${path}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || failMsg)
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : failMsg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {rows.length} declined estimate{rows.length === 1 ? '' : 's'} awaiting follow-up
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customer, equipment, serial, WO#"
          className="w-full sm:w-72 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
        />
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <FileX className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          No declined estimates to follow up.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Estimate" colKey="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <SortHeader label="Declined" colKey="age" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-4 py-3" />
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
              {sorted.map((r) => {
                const aging = agingBadge(r.days_since_declined)
                const busy = busyId === r.id
                return (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 align-top">
                    <td className="px-4 py-3">
                      <Link href={`/service/${r.id}`} className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400">
                        {r.customer_name}
                      </Link>
                      {r.work_order_number != null && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">WO-{r.work_order_number}</div>
                      )}
                      {r.technician_name && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">Tech: {r.technician_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-gray-100">{r.equipment_label}</div>
                      {r.serial_number && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">S/N {r.serial_number}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 tabular-nums">
                      {fmtMoney(r.estimate_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aging.classes}`}>
                        {aging.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-xs">
                      {r.decline_reason || <span className="text-gray-400 dark:text-gray-500">No reason given</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-col items-end gap-1.5">
                        <button
                          onClick={() => post(r.id, 'reopen-estimate', 'Failed to reopen the estimate')}
                          disabled={busy}
                          className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                        >
                          {busy ? 'Working…' : 'Reopen & re-quote'}
                        </button>
                        <button
                          onClick={() => post(r.id, 'resolve-decline', 'Failed to mark handled')}
                          disabled={busy}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          Mark handled
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
