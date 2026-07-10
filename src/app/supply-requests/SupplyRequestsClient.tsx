'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck, Download, FileText, Pencil, Ban, RotateCcw } from 'lucide-react'
import type { SupplyRequestQueueRow } from '@/lib/db/supply-requests'
import type { SupplyRequestItem } from '@/types/database'
import Tabs, { type TabItem } from '@/components/ui/Tabs'

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
    // Denied lines aren't pulled — leave them off the warehouse list.
    for (const it of r.items.filter((it) => !it.denied)) {
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

// Same pull list, rendered server-side as a printable PDF (@react-pdf) — one
// flattened line per item, matching the CSV. Mirrors parts-queue's PDF export.
async function exportPullListPdf(rows: SupplyRequestQueueRow[]) {
  const payload = rows.flatMap((r) =>
    // Denied lines aren't pulled — leave them off the warehouse list.
    r.items.filter((it) => !it.denied).map((it) => ({
      tech: r.requester_name,
      item: it.name,
      quantity: it.quantity,
      unit: it.unit ?? null,
    })),
  )
  const res = await fetch('/api/supply-requests/pull-list-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: payload }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to generate PDF')
  }
  const blob = await res.blob()
  triggerDownload(blob, `supply-pull-list-${new Date().toISOString().slice(0, 10)}.pdf`)
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

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

  // Persist office edits to a request's line items (quantities + per-line deny).
  async function saveItems(id: string, items: SupplyRequestItem[]) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/supply-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_items', items }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error || 'Failed to save changes')
      }
      setEditingId(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setBusyId(null)
    }
  }

  const tabs: TabItem[] = (['pending', 'ready', 'done'] as Tab[]).map((t) => ({
    key: t,
    label: TAB_LABEL[t],
    count: buckets[t].length,
  }))

  return (
    <div className="space-y-4">
      {/* Tabs + pull-list export */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Tabs
          ariaLabel="Filter supply requests"
          tabs={tabs}
          active={tab}
          onChange={(key) => setTab(key as Tab)}
          className="w-fit"
        />
        <div className="flex items-center gap-2">
          {buckets.pending.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => exportPullList(buckets.pending)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 w-fit"
                title="Download a CSV pull list of everything waiting to be pulled"
              >
                <Download className="h-4 w-4" />
                Pull list (CSV)
              </button>
              <button
                type="button"
                disabled={pdfBusy}
                onClick={async () => {
                  setPdfBusy(true)
                  setError(null)
                  try {
                    await exportPullListPdf(buckets.pending)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to generate PDF')
                  } finally {
                    setPdfBusy(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 w-fit"
                title="Download a printable PDF pull list of everything waiting to be pulled"
              >
                <FileText className="h-4 w-4" />
                {pdfBusy ? 'Generating…' : 'Pull list (PDF)'}
              </button>
            </>
          )}
        </div>
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
                  {editingId === r.id ? (
                    <LineEditor
                      request={r}
                      busy={busyId === r.id}
                      onCancel={() => setEditingId(null)}
                      onSave={(items) => saveItems(r.id, items)}
                    />
                  ) : (
                    <ul className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                      {r.items.map((it, i) => (
                        <li key={i}>
                          <span className={it.denied ? 'line-through text-gray-400 dark:text-gray-500' : ''}>
                            {it.name}
                            <span className="text-gray-400"> × {it.quantity}{it.unit ? ` ${it.unit}` : ''}</span>
                          </span>
                          {it.denied && (
                            <span className="ml-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                              denied{it.denied_reason ? `: ${it.denied_reason}` : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">“{r.note}”</p>}
                  {r.status === 'denied' && r.denied_reason && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">Reason: {r.denied_reason}</p>
                  )}
                </div>

                {/* Actions — hidden while the line editor is open (it has its own buttons) */}
                {editingId !== r.id && (
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
                            onClick={() => { setEditingId(r.id); setDenyingId(null); setError(null) }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                            title="Adjust quantities or deny individual lines"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
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
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Inline editor for a pending request's line items: adjust quantities and deny
// individual lines (feedback #65). A denied line keeps its quantity but won't be
// pulled; the office can restore it. Reason is optional.
type DraftItem = {
  name: string
  quantity: string // string while editing so the input can be cleared mid-edit
  unit: string | null
  catalog_id: string | null
  denied: boolean
  denied_reason: string
}

function LineEditor({
  request,
  busy,
  onCancel,
  onSave,
}: {
  request: SupplyRequestQueueRow
  busy: boolean
  onCancel: () => void
  onSave: (items: SupplyRequestItem[]) => void
}) {
  const [items, setItems] = useState<DraftItem[]>(() =>
    request.items.map((it) => ({
      name: it.name,
      quantity: String(it.quantity),
      unit: it.unit ?? null,
      catalog_id: it.catalog_id ?? null,
      denied: it.denied ?? false,
      denied_reason: it.denied_reason ?? '',
    })),
  )
  const [localError, setLocalError] = useState<string | null>(null)

  function update(i: number, changes: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...changes } : it)))
  }

  function handleSave() {
    const out: SupplyRequestItem[] = []
    for (const it of items) {
      const qty = Math.floor(Number(it.quantity))
      if (!Number.isFinite(qty) || qty <= 0) {
        setLocalError(`Enter a quantity greater than zero for "${it.name}".`)
        return
      }
      out.push({
        name: it.name,
        quantity: qty,
        catalog_id: it.catalog_id,
        unit: it.unit,
        ...(it.denied ? { denied: true, denied_reason: it.denied_reason.trim() || null } : {}),
      })
    }
    setLocalError(null)
    onSave(out)
  }

  const activeCount = items.filter((it) => !it.denied).length

  return (
    <div className="mt-2 space-y-2">
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`min-w-[6rem] flex-1 ${
                it.denied ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'
              }`}
            >
              {it.name}
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={it.quantity}
              disabled={it.denied || busy}
              onChange={(e) => update(i, { quantity: e.target.value })}
              className="w-16 px-2 py-1 text-xs text-right rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50"
              aria-label={`Quantity for ${it.name}`}
            />
            {it.unit && <span className="w-10 text-xs text-gray-400">{it.unit}</span>}
            {it.denied ? (
              <>
                <input
                  value={it.denied_reason}
                  onChange={(e) => update(i, { denied_reason: e.target.value })}
                  placeholder="Reason (optional)"
                  disabled={busy}
                  className="min-w-[6rem] flex-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  aria-label={`Denial reason for ${it.name}`}
                />
                <button
                  type="button"
                  onClick={() => update(i, { denied: false, denied_reason: '' })}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => update(i, { denied: true })}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Deny
              </button>
            )}
          </li>
        ))}
      </ul>
      {localError && <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>}
      {activeCount === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Every line is denied — consider denying the whole request instead.
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
