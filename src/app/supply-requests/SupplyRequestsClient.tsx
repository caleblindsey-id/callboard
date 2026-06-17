'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck, Download } from 'lucide-react'
import type { SupplyRequestQueueRow } from '@/lib/db/supply-requests'

// CSV cell escaper — quote when the value contains a comma, quote, or newline.
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Pull list for the warehouse — one row per item across all pending requests,
// grouped by tech, so it can all be pulled in one pass. Client-side, no route.
function exportPullList(rows: SupplyRequestQueueRow[]) {
  const header = ['Tech', 'Item', 'Qty', 'Unit', 'Requested', 'Note']
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    const requested = new Date(r.created_at).toLocaleDateString()
    for (const it of r.items) {
      lines.push(
        [
          csvCell(r.requester_name),
          csvCell(it.name),
          csvCell(it.quantity),
          csvCell(it.unit ?? ''),
          csvCell(requested),
          csvCell(r.note ?? ''),
        ].join(','),
      )
    }
  }
  // BOM so Excel opens the UTF-8 file with the right encoding.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `supply-pull-list-${new Date().toISOString().slice(0, 10)}.csv`)
}

type Tab = 'pending' | 'ready' | 'done'

const TAB_LABEL: Record<Tab, string> = {
  pending: 'Needs Pulling',
  ready: 'Ready',
  done: 'Recently Picked Up',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function agingBadge(days: number): { label: string; classes: string } {
  const label = days === 0 ? 'Today' : `${days}d`
  if (days <= 1) return { label, classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' }
  if (days <= 3) return { label, classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' }
  return { label, classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' }
}

export default function SupplyRequestsClient({ rows }: { rows: SupplyRequestQueueRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denyingId, setDenyingId] = useState<string | null>(null)
  const [denyReason, setDenyReason] = useState('')

  const buckets = useMemo(() => {
    const b: Record<Tab, SupplyRequestQueueRow[]> = { pending: [], ready: [], done: [] }
    for (const r of rows) {
      if (r.status === 'pending') b.pending.push(r)
      else if (r.status === 'ready') b.ready.push(r)
      else b.done.push(r) // picked_up or denied within the window
    }
    return b
  }, [rows])

  const visible = buckets[tab]

  async function act(id: string, action: string, reason?: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/supply-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error || 'Action failed')
      }
      setDenyingId(null)
      setDenyReason('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  const tabs: Tab[] = ['pending', 'ready', 'done']

  return (
    <div className="space-y-4">
      {/* Tabs + pull-list export */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {TAB_LABEL[t]}
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500 tabular-nums">{buckets[t].length}</span>
            </button>
          ))}
        </div>
        {buckets.pending.length > 0 && (
          <button
            type="button"
            onClick={() => exportPullList(buckets.pending)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 w-fit"
            title="Download a CSV pull list of everything waiting to be pulled"
          >
            <Download className="h-4 w-4" />
            Pull list (CSV)
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <PackageCheck className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          {tab === 'pending' ? 'No supply requests waiting to be pulled.' : tab === 'ready' ? 'Nothing staged for pickup.' : 'Nothing picked up recently.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{r.requester_name}</span>
                    {r.status === 'pending' && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${agingBadge(r.age_days).classes}`}>
                        {agingBadge(r.age_days).label}
                      </span>
                    )}
                    {r.status === 'picked_up' && (
                      <span className="text-xs text-gray-400">Picked up {fmtDate(r.picked_up_at)}</span>
                    )}
                    {r.status === 'denied' && (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Denied</span>
                    )}
                  </div>
                  <ul className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                    {r.items.map((it, i) => (
                      <li key={i}>
                        {it.name}
                        <span className="text-gray-400"> × {it.quantity}{it.unit ? ` ${it.unit}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                  {r.note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">“{r.note}”</p>}
                  {r.status === 'denied' && r.denied_reason && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">Reason: {r.denied_reason}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="shrink-0">
                  {denyingId === r.id ? (
                    <div className="flex flex-col items-stretch gap-1.5 w-full sm:w-56">
                      <input
                        autoFocus
                        value={denyReason}
                        onChange={(e) => setDenyReason(e.target.value)}
                        placeholder="Reason for denial"
                        className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => act(r.id, 'deny', denyReason.trim())}
                          disabled={busyId === r.id || denyReason.trim().length < 2}
                          className="flex-1 px-2.5 py-1 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                        >
                          {busyId === r.id ? 'Saving…' : 'Confirm deny'}
                        </button>
                        <button
                          onClick={() => { setDenyingId(null); setDenyReason('') }}
                          disabled={busyId === r.id}
                          className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => act(r.id, 'mark_ready')}
                            disabled={busyId === r.id}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                          >
                            {busyId === r.id ? 'Saving…' : 'Mark Ready'}
                          </button>
                          <button
                            onClick={() => { setDenyingId(r.id); setDenyReason(''); setError(null) }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                          >
                            Deny
                          </button>
                        </>
                      )}
                      {r.status === 'ready' && (
                        <>
                          <button
                            onClick={() => act(r.id, 'mark_picked_up')}
                            disabled={busyId === r.id}
                            className="px-3 py-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md hover:bg-indigo-100 dark:hover:bg-indigo-900/40 disabled:opacity-50"
                          >
                            {busyId === r.id ? 'Saving…' : 'Mark Picked Up'}
                          </button>
                          <button
                            onClick={() => act(r.id, 'reopen')}
                            disabled={busyId === r.id}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            Reopen
                          </button>
                        </>
                      )}
                      {(r.status === 'picked_up' || r.status === 'denied') && (
                        <button
                          onClick={() => act(r.id, 'reopen')}
                          disabled={busyId === r.id}
                          className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          {busyId === r.id ? 'Saving…' : 'Reopen'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
