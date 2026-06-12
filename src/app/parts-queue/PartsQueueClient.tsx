'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, ExternalLink, FileText, PackageCheck, RefreshCw, XCircle } from 'lucide-react'
import type { PartRequest, PartsQueueRow, PartsQueueSource } from '@/types/database'
import {
  cancelPart,
  markPartOrdered,
  markPartPulled,
  markPartReceived,
  revalidateTicket,
  setSynergyOrderNumber,
  ticketDeepLink,
  triagePart,
  updatePartFields,
} from '@/lib/parts-queue'
import { partLabel } from '@/lib/parts'
import CancelPartDialog from './CancelPartDialog'
import TriageOrderDialog from './TriageOrderDialog'
import VendorPicker from '@/components/VendorPicker'
import { formatDateTime } from '@/lib/format'
import { suggestVendor } from '@/lib/parts-vendor-suggestions'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

type Tab = 'review' | 'to_pull' | 'to_order' | 'ordered' | 'received'
type SortKey =
  | 'requested_at'
  | 'source'
  | 'work_order_number'
  | 'customer_name'
  | 'synergy_order_number'
  | 'description'
  | 'quantity'
  | 'unit_price'
  | 'vendor'
  | 'product_number'
  | 'vendor_item_code'
  | 'po_number'
  | 'assigned_technician_name'
  | 'ordered_at'
  | 'received_at'

const RECEIVED_WINDOW_DAYS = 14
const RECEIVED_WINDOW_MS = RECEIVED_WINDOW_DAYS * 24 * 60 * 60 * 1000

function rowKey(r: Pick<PartsQueueRow, 'source' | 'ticket_id' | 'part_index'>): string {
  return `${r.source}:${r.ticket_id}:${r.part_index}`
}

// Collapses the two underlying validation columns into a single state for the
// badge: 'invalid' (order # not in Synergy) trumps anything part-level, then
// 'partial' (some parts not on the order) is amber, then a missing
// synergy_validation_status means "validation hasn't run yet for this ticket"
// (same-day order, typo correction). A row with no order # at all has nothing
// to validate and gets no badge.
export type ValidationState = 'valid' | 'invalid' | 'partial' | 'pending' | 'none'

function deriveValidationState(row: PartsQueueRow): ValidationState {
  if (!row.synergy_order_number) return 'none'
  if (row.synergy_validation_status === 'invalid') return 'invalid'
  if (row.parts_validation_status === 'invalid') return 'invalid'
  if (row.parts_validation_status === 'partial') return 'partial'
  // Treat NULL and the literal 'pending' (migration-028 DEFAULT on
  // service_tickets) as the same "not yet validated" bucket.
  if (
    row.synergy_validation_status === null ||
    row.synergy_validation_status === 'pending'
  )
    return 'pending'
  return 'valid'
}

function partToRow(row: PartsQueueRow, part: PartRequest): PartsQueueRow {
  return {
    ...row,
    description: part.description ?? row.description,
    detail: part.detail ?? row.detail,
    quantity: part.quantity ?? row.quantity,
    unit_price: part.unit_price ?? row.unit_price,
    // machine_* are ticket-level (from the view's equipment join) and aren't
    // editable from the queue, so they're preserved from the existing row.
    vendor: part.vendor ?? null,
    vendor_code: part.vendor_code ?? null,
    product_number: part.product_number ?? null,
    synergy_product_id: part.synergy_product_id ?? null,
    vendor_item_code: part.vendor_item_code ?? null,
    po_number: part.po_number ?? null,
    status: part.status,
    cancelled: part.cancelled ?? false,
    cancel_reason: part.cancel_reason ?? null,
    ordered_at: part.ordered_at ?? null,
    received_at: part.received_at ?? null,
    ordered_by: part.ordered_by ?? null,
    received_by: part.received_by ?? null,
    pulled_at: part.pulled_at ?? null,
    pulled_by: part.pulled_by ?? null,
    requested_at: part.requested_at ?? row.requested_at,
  }
}

function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

function sortRows(rows: PartsQueueRow[], key: SortKey, dir: 'asc' | 'desc'): PartsQueueRow[] {
  const mult = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[key] as unknown
    const bv = b[key] as unknown
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mult
  })
}

// Escape one CSV cell: wrap in quotes and double any embedded quotes so commas /
// newlines / quotes in part descriptions don't break the columns.
function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

// Build + download a pick list for the To-Pull rows. Sorted by Synergy Item #
// so the puller walks the service-dept shelf in order. Client-side only — no
// route, no dependency.
function exportPickList(rows: PartsQueueRow[]) {
  const sorted = [...rows].sort((a, b) =>
    String(a.product_number ?? '').localeCompare(String(b.product_number ?? ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  )
  const header = ['Bin', 'Synergy Item #', 'Part', 'Qty', 'Machine', 'Customer', 'WO #', 'Tech']
  const lines = [header.map(csvCell).join(',')]
  for (const r of sorted) {
    const machine = [r.machine_make, r.machine_model, r.machine_serial ? `S/N ${r.machine_serial}` : '']
      .filter(Boolean)
      .join(' ')
    lines.push(
      [
        csvCell(r.bin_location),
        csvCell(r.product_number),
        csvCell(partLabel(r) || r.description),
        csvCell(r.quantity ?? 1),
        csvCell(machine),
        csvCell(r.customer_name),
        csvCell(r.work_order_number),
        csvCell(r.assigned_technician_name),
      ].join(','),
    )
  }
  // Prepend a BOM so Excel opens the UTF-8 file with the right encoding.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `pick-list-${new Date().toISOString().slice(0, 10)}.csv`)
}

// Shared blob → download helper.
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

// PDF pick list — same data as the CSV, rendered server-side (@react-pdf) into a
// printable sheet. POSTs the trimmed To-Pull rows; the route is manager-gated.
async function exportPickListPdf(rows: PartsQueueRow[]) {
  const sorted = [...rows].sort((a, b) =>
    String(a.product_number ?? '').localeCompare(String(b.product_number ?? ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  )
  const payload = sorted.map((r) => ({
    bin_location: r.bin_location,
    product_number: r.product_number,
    part: partLabel(r) || r.description,
    quantity: r.quantity,
    machine: [r.machine_make, r.machine_model, r.machine_serial ? `S/N ${r.machine_serial}` : '']
      .filter(Boolean)
      .join(' ') || null,
    customer_name: r.customer_name,
    work_order_number: r.work_order_number,
    technician_name: r.assigned_technician_name,
  }))
  const res = await fetch('/api/parts-queue/pick-list-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: payload }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to generate PDF')
  }
  const blob = await res.blob()
  triggerDownload(blob, `pick-list-${new Date().toISOString().slice(0, 10)}.pdf`)
}

interface Props {
  rows: PartsQueueRow[]
  // Round B (service-ticket deep-link) sets this from ?ticket= on the URL. When
  // set, the table is narrowed to just that ticket and a "clear filter" chip
  // surfaces above the table. Defaults to null on a direct /parts-queue visit.
  initialTicketFilter?: string | null
  // tab/sort/dir/q/source/vendor seeded from the URL so Back restores the view.
  initialFilters: { tab: string; sort: string; dir: string; q: string; source: string; vendor: string }
}

export default function PartsQueueClient({
  rows: initialRows,
  initialTicketFilter = null,
  initialFilters,
}: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<PartsQueueRow[]>(initialRows)
  // Filter controls live in the URL so the Back button restores them. The
  // ?ticket deep-link prefilter is part of the same managed set so clearing the
  // chip drops it from the URL too.
  const { filters, set, setMany } = useUrlFilters({ ...initialFilters, ticket: initialTicketFilter ?? '' })
  // Review is the new front door (un-triaged requests land there). A deep-link
  // from a source ticket wants the ordering view, so it opens on To Order.
  const tab = (filters.tab || (initialTicketFilter ? 'to_order' : 'review')) as Tab
  const sortKey = (filters.sort || 'requested_at') as SortKey
  const sortDir: 'asc' | 'desc' = filters.dir === 'desc' ? 'desc' : 'asc'
  const search = filters.q
  const sourceFilter = (filters.source || 'all') as 'all' | PartsQueueSource
  const vendorFilter = filters.vendor
  const ticketFilter = filters.ticket
  const [pendingRow, setPendingRow] = useState<string | null>(null)
  const [flashedRow, setFlashedRow] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PartsQueueRow | null>(null)
  const [orderJustifyTarget, setOrderJustifyTarget] = useState<PartsQueueRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Refresh the cutoff every 5 min so a long-lived session doesn't silently
  // drop parts that aged out, and so the value stays stable between unrelated
  // re-renders (memos below depend on it).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [])
  const receivedCutoffMs = useMemo(() => now - RECEIVED_WINDOW_MS, [now])

  const tabCounts = useMemo(() => {
    let review = 0
    let toPull = 0
    let toOrder = 0
    let ordered = 0
    let received = 0
    for (const r of rows) {
      if (r.cancelled) continue
      if (r.status === 'pending_review') review++
      else if (r.status === 'from_stock' && !r.pulled_at) toPull++
      else if (r.status === 'requested') toOrder++
      else if (r.status === 'ordered') ordered++
      else if (r.status === 'received' && r.received_at && new Date(r.received_at).getTime() >= receivedCutoffMs)
        received++
    }
    return { review, toPull, toOrder, ordered, received }
  }, [rows, receivedCutoffMs])

  // Shared row predicate. `skipVendor` lets the vendor dropdown derive its
  // options from rows that match every *other* active filter — otherwise the
  // selected vendor would collapse the dropdown to a single option.
  const matchesFilters = useCallback((r: PartsQueueRow, skipVendor = false) => {
    if (r.cancelled) return false
    // Tab filter
    if (tab === 'review' && r.status !== 'pending_review') return false
    if (tab === 'to_pull' && (r.status !== 'from_stock' || !!r.pulled_at)) return false
    if (tab === 'to_order' && r.status !== 'requested') return false
    if (tab === 'ordered' && r.status !== 'ordered') return false
    if (tab === 'received') {
      if (r.status !== 'received') return false
      if (!r.received_at) return false
      if (new Date(r.received_at).getTime() < receivedCutoffMs) return false
    }
    // Ticket prefilter (Round B deep-link from /service/<id>) — takes
    // precedence over the source dropdown so a deep-link still shows the
    // exact ticket's parts.
    if (ticketFilter && r.ticket_id !== ticketFilter) return false
    // Source filter
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false
    // Vendor filter
    if (!skipVendor && vendorFilter && (r.vendor ?? '') !== vendorFilter) return false
    // Search
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = [
        r.customer_name,
        r.description,
        r.detail,
        r.work_order_number?.toString(),
        r.product_number,
        r.vendor_item_code,
        r.po_number,
        r.vendor,
        r.assigned_technician_name,
        r.machine_make,
        r.machine_model,
        r.machine_serial,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }, [tab, sourceFilter, vendorFilter, search, receivedCutoffMs, ticketFilter])

  // Only offer vendors present in the rows currently visible (post every other
  // filter), so the dropdown reflects what's on the page. Always keep the
  // active selection present even if it now matches nothing, so the <select>
  // doesn't point at a missing option and render blank.
  const vendorOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.vendor && matchesFilters(r, true)) set.add(r.vendor)
    if (vendorFilter) set.add(vendorFilter)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows, matchesFilters, vendorFilter])

  const filteredRows = useMemo(() => {
    const result = rows.filter(r => matchesFilters(r))
    return sortRows(result, sortKey, sortDir)
  }, [rows, matchesFilters, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setMany({ dir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      setMany({ sort: key, dir: 'asc' })
    }
  }

  const flash = useCallback((key: string) => {
    setFlashedRow(key)
    window.setTimeout(() => {
      setFlashedRow(cur => (cur === key ? null : cur))
    }, 1200)
  }, [])

  const applyUpdate = useCallback((row: PartsQueueRow, part: PartRequest) => {
    const next = partToRow(row, part)
    setRows(rs => rs.map(r => (rowKey(r) === rowKey(row) ? next : r)))
    flash(rowKey(row))
  }, [flash])

  const handleFieldsCommit = useCallback(async (row: PartsQueueRow, fields: Partial<PartRequest>) => {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await updatePartFields(row.source, row.ticket_id, row.part_index, fields)
      applyUpdate(row, part)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      router.refresh()
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [applyUpdate, router])

  const handleFieldBlur = useCallback(async (row: PartsQueueRow, field: keyof PartRequest, value: string) => {
    const trimmed = value.trim()
    const current = (row[field as keyof PartsQueueRow] ?? '') as string
    if (trimmed === (current ?? '')) return
    const fields: Partial<PartRequest> = { [field]: trimmed || undefined } as Partial<PartRequest>
    await handleFieldsCommit(row, fields)
  }, [handleFieldsCommit])

  const handleMarkOrdered = useCallback(async (row: PartsQueueRow) => {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await markPartOrdered(row.source, row.ticket_id, row.part_index)
      applyUpdate(row, part)
      set('tab', 'ordered')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark ordered')
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [applyUpdate])

  const handleMarkReceived = useCallback(async (row: PartsQueueRow) => {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await markPartReceived(row.source, row.ticket_id, row.part_index)
      applyUpdate(row, part)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark received')
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [applyUpdate])

  const handleMarkPulled = useCallback(async (row: PartsQueueRow) => {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await markPartPulled(row.source, row.ticket_id, row.part_index)
      applyUpdate(row, part)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark pulled')
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [applyUpdate])

  const [pdfPending, setPdfPending] = useState(false)
  const handleExportPdf = useCallback(async (rowsToExport: PartsQueueRow[]) => {
    setPdfPending(true)
    setError(null)
    try {
      await exportPickListPdf(rowsToExport)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF')
    } finally {
      setPdfPending(false)
    }
  }, [])

  const handleSynergyOrderCommit = useCallback(async (row: PartsQueueRow, value: string) => {
    const trimmed = value.trim()
    const current = row.synergy_order_number ?? ''
    if (trimmed === current) return
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const next = await setSynergyOrderNumber(row.source, row.ticket_id, trimmed || null)
      // SO# lives on the parent ticket — every part row sharing this
      // (source, ticket_id) must reflect the new value.
      setRows(rs =>
        rs.map(r =>
          r.ticket_id === row.ticket_id && r.source === row.source
            ? { ...r, synergy_order_number: next }
            : r,
        ),
      )
      flash(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Synergy order #')
      router.refresh()
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [flash, router])

  const handleRevalidate = useCallback(async (row: PartsQueueRow) => {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    setInfo(null)
    try {
      const outcome = await revalidateTicket(row.source, row.ticket_id)
      if (outcome.state === 'queued') {
        // Workstation hasn't drained the request within the poll window (offline
        // or busy). It'll be picked up by the next drain, and the 5:30 AM nightly
        // run catches everything regardless — so this is informational, not an error.
        setInfo('Queued — the office sync will re-check this within a few minutes.')
        return
      }
      const { result } = outcome
      // Stamp the new validation status onto every row that shares this ticket
      // (each ticket can have multiple parts, all sharing one parent status).
      setRows((rs) =>
        rs.map((r) =>
          r.ticket_id === row.ticket_id && r.source === row.source
            ? {
                ...r,
                synergy_validation_status: result.synergy_validation_status,
                parts_validation_status: result.parts_validation_status,
                synergy_validated_at: result.synergy_validated_at,
              }
            : r,
        ),
      )
      flash(key)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-validate')
    } finally {
      setPendingRow((cur) => (cur === key ? null : cur))
    }
  }, [flash])

  const handleConfirmCancel = useCallback(async (reason: string) => {
    if (!cancelTarget) return
    const row = cancelTarget
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await cancelPart(row.source, row.ticket_id, row.part_index, reason)
      applyUpdate(row, part)
      setCancelTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
      throw err
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }, [cancelTarget, applyUpdate])

  // Stock-vs-order triage of a pending_review part. After it lands, the part's
  // status changes and the row drops out of the Review tab automatically.
  const handleTriage = useCallback(
    async (row: PartsQueueRow, decision: 'order' | 'stock', reason?: string) => {
      const key = rowKey(row)
      setPendingRow(key)
      setError(null)
      try {
        const part = await triagePart(row.source, row.ticket_id, row.part_index, decision, reason)
        applyUpdate(row, part)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to triage part')
      } finally {
        setPendingRow(cur => (cur === key ? null : cur))
      }
    },
    [applyUpdate],
  )

  // Ordering a part we already stock requires a justification, so it routes
  // through the dialog; ordering a part with no stock/PO goes straight through.
  const handleOrderClick = useCallback(
    (row: PartsQueueRow) => {
      const haveStock = (row.qty_on_hand ?? 0) > 0 || (row.qty_on_po ?? 0) > 0
      if (haveStock) {
        setOrderJustifyTarget(row)
      } else {
        void handleTriage(row, 'order')
      }
    },
    [handleTriage],
  )

  const handleConfirmOrderJustify = useCallback(
    async (reason: string) => {
      if (!orderJustifyTarget) return
      const row = orderJustifyTarget
      await handleTriage(row, 'order', reason)
      setOrderJustifyTarget(null)
    },
    [orderJustifyTarget, handleTriage],
  )

  const canEditFields = tab !== 'received' && tab !== 'review'
  const canMarkOrdered = tab === 'to_order'
  const canMarkReceived = tab === 'ordered'
  // canCancel is now derived per-row inline (status-aware) instead of tab-driven —
  // see the row-render block.

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <TabButton active={tab === 'review'} onClick={() => set('tab', 'review')} label="Review" count={tabCounts.review} />
        <TabButton active={tab === 'to_pull'} onClick={() => set('tab', 'to_pull')} label="To Pull" count={tabCounts.toPull} />
        <TabButton active={tab === 'to_order'} onClick={() => set('tab', 'to_order')} label="To Order" count={tabCounts.toOrder} />
        <TabButton active={tab === 'ordered'} onClick={() => set('tab', 'ordered')} label="Ordered" count={tabCounts.ordered} />
        <TabButton active={tab === 'received'} onClick={() => set('tab', 'received')} label={`Received (${RECEIVED_WINDOW_DAYS}d)`} count={tabCounts.received} />
      </div>

      {/* Ticket prefilter chip — only present when the page was loaded via a
          deep-link from a source ticket (Round B). Clears back to the normal
          full-queue view without a navigation. */}
      {ticketFilter && (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            Filtered to one ticket
            {initialFilters.source ? ` (${initialFilters.source === 'pm' ? 'PM' : 'Service'})` : ''}
            .
          </span>
          <button
            type="button"
            onClick={() => {
              setMany({ ticket: '', source: 'all' })
            }}
            className="text-slate-700 dark:text-slate-200 underline hover:text-slate-900 dark:hover:text-white"
          >
            Show all parts
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={search}
          onChange={e => set('q', e.target.value, { debounce: true })}
          placeholder="Search customer, WO #, part, PO #…"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <select
          value={sourceFilter}
          onChange={e => set('source', e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="all">All sources</option>
          <option value="pm">PM only</option>
          <option value="service">Service only</option>
        </select>
        <select
          value={vendorFilter}
          onChange={e => set('vendor', e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="">All vendors</option>
          {vendorOptions.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {info && (
        <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
          {info}
        </div>
      )}

      {/* Table */}
      {tab === 'review' ? (
        <ReviewTable
          rows={filteredRows}
          pendingRow={pendingRow}
          flashedRow={flashedRow}
          onOrder={handleOrderClick}
          onStock={(row) => void handleTriage(row, 'stock')}
          onCancel={setCancelTarget}
        />
      ) : tab === 'to_pull' ? (
        <ToPullTable
          rows={filteredRows}
          pendingRow={pendingRow}
          flashedRow={flashedRow}
          onMarkPulled={handleMarkPulled}
          onExportCsv={() => exportPickList(filteredRows)}
          onExportPdf={() => handleExportPdf(filteredRows)}
          pdfPending={pdfPending}
        />
      ) : (
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <SortHeader label="Requested" colKey="requested_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Source" colKey="source" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
              <SortHeader label="Synergy PO #" colKey="po_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Synergy Order #" colKey="synergy_order_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="WO #" colKey="work_order_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Vendor" colKey="vendor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Customer" colKey="customer_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Part" colKey="description" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th scope="col" className="px-3 py-2 text-left font-semibold" title="PM only: whether the customer is charged (Billable) or it's included in the PM agreement (Covered).">Billing</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Machine</th>
              <SortHeader label="Qty" colKey="quantity" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Price" colKey="unit_price" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th
                scope="col"
                className="px-3 py-2 text-left font-semibold"
                title="Hint based on part description — not auto-applied. Pick the actual vendor in the Vendor column."
              >
                Suggested
              </th>
              <SortHeader label="Synergy Item #" colKey="product_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Vendor Item #" colKey="vendor_item_code" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Requested by" colKey="assigned_technician_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              {tab === 'ordered' && (
                <SortHeader label="Ordered" colKey="ordered_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              )}
              {tab === 'received' && (
                <SortHeader label="Received" colKey="received_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              )}
              <th scope="col" className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={17 + (tab === 'ordered' || tab === 'received' ? 1 : 0)}
                  className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {tab === 'to_order' && "No parts waiting to be ordered — you're caught up."}
                  {tab === 'ordered' && 'Nothing on order right now.'}
                  {tab === 'received' && `No parts received in the last ${RECEIVED_WINDOW_DAYS} days.`}
                </td>
              </tr>
            ) : (
              filteredRows.map(row => {
                const key = rowKey(row)
                const isPending = pendingRow === key
                const isFlashed = flashedRow === key
                return (
                  <tr
                    key={key}
                    className={`transition-colors ${
                      isFlashed
                        ? 'bg-green-50 dark:bg-green-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {formatDay(row.requested_at)}
                    </td>
                    <td className="px-3 py-2">
                      <SourceBadge source={row.source} />
                    </td>
                    <td className="px-3 py-2">
                      <ValidationBadge
                        state={deriveValidationState(row)}
                        synergyOrderNumber={row.synergy_order_number}
                        onRevalidate={() => handleRevalidate(row)}
                        disabled={isPending}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.po_number ?? ''}
                        placeholder="Synergy PO #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'po_number', v)}
                        widthClass="w-24"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.synergy_order_number ?? ''}
                        placeholder="SO #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleSynergyOrderCommit(row, v)}
                        widthClass="w-24"
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {row.work_order_number ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <VendorPicker
                        vendor={row.vendor}
                        vendorCode={row.vendor_code}
                        disabled={!canEditFields || isPending}
                        onChange={picked =>
                          handleFieldsCommit(row, { vendor: picked.vendor, vendor_code: picked.vendor_code })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[200px] truncate" title={row.customer_name ?? ''}>
                      {row.customer_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[240px] truncate" title={partLabel(row) || (row.description ?? '')}>
                      {partLabel(row) || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <CoverageBadge covered={row.covered_by_agreement} />
                    </td>
                    <td className="px-3 py-2">
                      <MachineCell make={row.machine_make} model={row.machine_model} serial={row.machine_serial} />
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.quantity ?? 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">
                      {row.unit_price == null ? '—' : `$${row.unit_price.toFixed(2)}`}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                      <SuggestedVendor description={row.description} pickedVendor={row.vendor} />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.product_number ?? ''}
                        placeholder="Synergy Item #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'product_number', v)}
                        widthClass="w-28"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.vendor_item_code ?? ''}
                        placeholder="Vendor Item #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'vendor_item_code', v)}
                        widthClass="w-28"
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[140px] truncate">
                      {row.assigned_technician_name ?? '—'}
                    </td>
                    {tab === 'ordered' && (
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {formatDateTime(row.ordered_at)}
                      </td>
                    )}
                    {tab === 'received' && (
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {formatDateTime(row.received_at)}
                      </td>
                    )}
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <div className="flex items-center gap-1 justify-end">
                        {canMarkOrdered && (
                          <button
                            type="button"
                            disabled={isPending || !row.product_number?.trim() || !row.po_number?.trim()}
                            onClick={() => handleMarkOrdered(row)}
                            title={
                              !row.product_number?.trim()
                                ? 'Enter Synergy Item # first'
                                : !row.po_number?.trim()
                                ? 'Enter Synergy PO # first'
                                : 'Mark ordered'
                            }
                            className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Mark Ordered
                          </button>
                        )}
                        {canMarkReceived && (
                          <button
                            type="button"
                            disabled={isPending || !row.product_number?.trim()}
                            onClick={() => handleMarkReceived(row)}
                            title={!row.product_number?.trim() ? 'Enter Synergy Item # first' : 'Mark received'}
                            className="px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Mark Received
                          </button>
                        )}
                        {/* Cancel is gated on row status (not just tab) so a
                            received row never shows an enabled cancel button. */}
                        {!row.cancelled && row.status !== 'received' && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => setCancelTarget(row)}
                            title="Cancel request"
                            className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded disabled:opacity-40 transition-colors"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                        <Link
                          href={ticketDeepLink(row.source, row.ticket_id)}
                          title={
                            row.source === 'pm'
                              ? 'Open source PM ticket'
                              : 'Open source service ticket'
                          }
                          aria-label="Open source ticket"
                          className="p-1 text-gray-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 rounded transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      <CancelPartDialog
        open={!!cancelTarget}
        description={cancelTarget?.description ?? ''}
        onCancel={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
      />

      <TriageOrderDialog
        open={!!orderJustifyTarget}
        description={orderJustifyTarget?.description ?? ''}
        qtyOnHand={orderJustifyTarget?.qty_on_hand ?? null}
        qtyOnPo={orderJustifyTarget?.qty_on_po ?? null}
        onCancel={() => setOrderJustifyTarget(null)}
        onConfirm={handleConfirmOrderJustify}
      />
    </div>
  )
}

// Stock-position chip for the Review tab. null = no catalog stock record (manual
// part); <= 0 shows a muted zero; > 0 highlights so the office sees it at a glance.
function StockBadge({ value, tone }: { value: number | null; tone: 'hand' | 'po' }) {
  if (value == null) return <span className="text-gray-400 dark:text-gray-500">—</span>
  if (value <= 0) return <span className="text-gray-400 dark:text-gray-500 tabular-nums">{value}</span>
  const classes =
    tone === 'hand'
      ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'
      : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${classes}`}>
      {value}
    </span>
  )
}

// Dedicated triage table for the Review tab. Surfaces On-Hand / On-PO so the
// office can decide "pull from stock" vs "order" per part. Intentionally separate
// from the ordering table (whose 17 PO/vendor/validation columns don't apply yet).
function ReviewTable({
  rows,
  pendingRow,
  flashedRow,
  onOrder,
  onStock,
  onCancel,
}: {
  rows: PartsQueueRow[]
  pendingRow: string | null
  flashedRow: string | null
  onOrder: (row: PartsQueueRow) => void
  onStock: (row: PartsQueueRow) => void
  onCancel: (row: PartsQueueRow) => void
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Requested</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Source</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">WO #</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Customer</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Part</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Machine</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Qty</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold" title="Units on hand in the service warehouse (Whse 4).">On Hand</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold" title="Units inbound on an open purchase order.">On PO</th>
            <th scope="col" className="px-3 py-2 text-left font-semibold">Requested by</th>
            <th scope="col" className="px-3 py-2 text-right">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No parts waiting on a stock-vs-order decision.
              </td>
            </tr>
          ) : (
            rows.map(row => {
              const key = rowKey(row)
              const isPending = pendingRow === key
              const isFlashed = flashedRow === key
              return (
                <tr
                  key={key}
                  className={`transition-colors ${
                    isFlashed ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{formatDay(row.requested_at)}</td>
                  <td className="px-3 py-2"><SourceBadge source={row.source} /></td>
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-white">{row.work_order_number ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[200px] truncate" title={row.customer_name ?? ''}>{row.customer_name ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[240px] truncate" title={partLabel(row) || (row.description ?? '')}>{partLabel(row) || '—'}</td>
                  <td className="px-3 py-2"><MachineCell make={row.machine_make} model={row.machine_model} serial={row.machine_serial} /></td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300 tabular-nums">{row.quantity ?? 1}</td>
                  <td className="px-3 py-2"><StockBadge value={row.qty_on_hand} tone="hand" /></td>
                  <td className="px-3 py-2"><StockBadge value={row.qty_on_po} tone="po" /></td>
                  <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[140px] truncate">{row.assigned_technician_name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onStock(row)}
                        title="Fulfill this part from existing stock — no PO"
                        className="px-2 py-1 text-xs font-medium text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Pull from Stock
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onOrder(row)}
                        title="Send this part to the order queue"
                        className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Order
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => onCancel(row)}
                        title="Cancel request"
                        className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 rounded disabled:opacity-40 transition-colors"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                      <Link
                        href={ticketDeepLink(row.source, row.ticket_id)}
                        title={row.source === 'pm' ? 'Open source PM ticket' : 'Open source service ticket'}
                        aria-label="Open source ticket"
                        className="p-1 text-gray-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 rounded transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

// Fulfillment table for the To-Pull tab: 'from_stock' parts the office decided
// to pull off the shelf but hasn't physically staged yet. Export builds a pick
// list (sorted by Synergy Item #); Mark Pulled stages the part for the tech and
// drops it from the tab. Separate from the ordering table — none of the
// PO/vendor/validation columns apply to a stock pull.
function ToPullTable({
  rows,
  pendingRow,
  flashedRow,
  onMarkPulled,
  onExportCsv,
  onExportPdf,
  pdfPending,
}: {
  rows: PartsQueueRow[]
  pendingRow: string | null
  flashedRow: string | null
  onMarkPulled: (row: PartsQueueRow) => void
  onExportCsv: () => void
  onExportPdf: () => void
  pdfPending: boolean
}) {
  const exportBtn =
    'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px] lg:min-h-0'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Parts decided to pull from stock, with their Whse 4 bin. Export the pick list, pull them off
          the shelf, then mark each pulled — the tech is notified once the whole order is staged.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onExportCsv}
            disabled={rows.length === 0}
            title="Download the pick list as CSV (sorted by Synergy Item #)"
            className={exportBtn}
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            disabled={rows.length === 0 || pdfPending}
            title="Download the pick list as a printable PDF"
            className={exportBtn}
          >
            <FileText className="h-4 w-4" />
            {pdfPending ? 'Generating…' : 'PDF'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold" title="Whse 4 bin/shelf location(s)">Bin</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Decided</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Source</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">WO #</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Customer</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Part</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Synergy Item #</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Machine</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Qty</th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Requested by</th>
              <th scope="col" className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  Nothing waiting to be pulled from stock.
                </td>
              </tr>
            ) : (
              rows.map(row => {
                const key = rowKey(row)
                const isPending = pendingRow === key
                const isFlashed = flashedRow === key
                return (
                  <tr
                    key={key}
                    className={`transition-colors ${
                      isFlashed ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                    }`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-900 dark:text-white">{row.bin_location ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">{formatDay(row.triaged_at)}</td>
                    <td className="px-3 py-2"><SourceBadge source={row.source} /></td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-white">{row.work_order_number ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[200px] truncate" title={row.customer_name ?? ''}>{row.customer_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[240px] truncate" title={partLabel(row) || (row.description ?? '')}>{partLabel(row) || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300">{row.product_number ?? '—'}</td>
                    <td className="px-3 py-2"><MachineCell make={row.machine_make} model={row.machine_model} serial={row.machine_serial} /></td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 tabular-nums">{row.quantity ?? 1}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[140px] truncate">{row.assigned_technician_name ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => onMarkPulled(row)}
                          title="Mark this part pulled from stock and staged for the tech"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          Mark Pulled
                        </button>
                        <Link
                          href={ticketDeepLink(row.source, row.ticket_id)}
                          title={row.source === 'pm' ? 'Open source PM ticket' : 'Open source service ticket'}
                          aria-label="Open source ticket"
                          className="p-1 text-gray-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 rounded transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-slate-700 text-slate-900 dark:border-white dark:text-white'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
      }`}
    >
      {label}
      <span
        className={`inline-flex items-center justify-center rounded-full text-xs min-w-[1.5rem] px-1.5 py-0.5 ${
          active
            ? 'bg-slate-700 text-white dark:bg-white dark:text-slate-900'
            : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function SortHeader({
  label,
  colKey,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onClick: (k: SortKey) => void
}) {
  const active = sortKey === colKey
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th scope="col" className="px-3 py-2 text-left font-semibold">
      <button
        type="button"
        onClick={() => onClick(colKey)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors ${
          active ? 'text-gray-800 dark:text-gray-200' : ''
        }`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    </th>
  )
}

function SuggestedVendor({
  description,
  pickedVendor,
}: {
  description: string | null
  pickedVendor: string | null
}) {
  const suggestion = suggestVendor(description)
  if (!suggestion) return <span aria-hidden="true">—</span>

  // Highlight the suggestion when it doesn't match what's actually picked so
  // the coordinator notices the conflict; muted when it matches (or nothing
  // is picked yet) so it doesn't pull focus.
  const conflicts =
    pickedVendor != null &&
    pickedVendor.trim().length > 0 &&
    pickedVendor.toLowerCase() !== suggestion.toLowerCase()

  return (
    <span
      title={
        conflicts
          ? `Suggestion differs from the picked vendor — double-check before ordering.`
          : `Hint based on part description.`
      }
      className={
        conflicts
          ? 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
          : 'text-gray-500 dark:text-gray-400'
      }
    >
      {suggestion}
    </span>
  )
}

function MachineCell({
  make,
  model,
  serial,
}: {
  make: string | null
  model: string | null
  serial: string | null
}) {
  const heading = [make, model].filter(Boolean).join(' ')
  if (!heading && !serial) return <span className="text-gray-400 dark:text-gray-500">—</span>
  return (
    <div className="max-w-[180px]">
      {heading && (
        <div className="text-gray-900 dark:text-white truncate" title={heading}>
          {heading}
        </div>
      )}
      {serial && (
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate" title={serial}>
          S/N {serial}
        </div>
      )}
    </div>
  )
}

function SourceBadge({ source }: { source: PartsQueueSource }) {
  const isPm = source === 'pm'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isPm
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      }`}
    >
      {isPm ? 'PM' : 'Service'}
    </span>
  )
}

// Covered (no customer charge) vs Billable, set by the tech at request time.
// PM-only — service rows and pre-feature PM rows carry null and show a muted
// dash so the office can tell "not classified" apart from a deliberate pick.
function CoverageBadge({ covered }: { covered: boolean | null }) {
  if (covered === null) return <span className="text-gray-400 dark:text-gray-500">—</span>
  return covered ? (
    <span
      title="Included in the PM agreement — customer is not charged."
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
    >
      Covered
    </span>
  ) : (
    <span
      title="Not included in the PM agreement — billed to the customer."
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
    >
      Billable
    </span>
  )
}

function ValidationBadge({
  state,
  synergyOrderNumber,
  onRevalidate,
  disabled,
}: {
  state: ValidationState
  synergyOrderNumber: string | null
  onRevalidate: () => void
  disabled: boolean
}) {
  if (state === 'none' || state === 'valid') return null

  const config: Record<
    Exclude<ValidationState, 'none' | 'valid'>,
    { label: string; tooltip: string; classes: string; canRevalidate: boolean }
  > = {
    invalid: {
      label: 'Needs Review',
      tooltip: synergyOrderNumber
        ? `Synergy Order #${synergyOrderNumber} not found, or its part #s don't match.`
        : 'Validation failed.',
      classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
      canRevalidate: true,
    },
    partial: {
      label: 'Partial',
      tooltip: synergyOrderNumber
        ? `Synergy Order #${synergyOrderNumber} found, but some part #s don't appear on it.`
        : 'Some parts found, some not.',
      classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      canRevalidate: true,
    },
    pending: {
      label: 'Pending',
      tooltip:
        'Validation hasn\'t run for this order yet. It runs nightly at 5:30 AM, or click re-check.',
      classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      canRevalidate: true,
    },
  }
  const { label, tooltip, classes, canRevalidate } = config[state]

  return (
    <div className="inline-flex items-center gap-1" title={tooltip}>
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}
      >
        {label}
      </span>
      {canRevalidate && (
        <button
          type="button"
          onClick={onRevalidate}
          disabled={disabled}
          title="Re-check against Synergy"
          aria-label="Re-check against Synergy"
          className="p-0.5 text-gray-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 rounded disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${disabled ? 'animate-spin' : ''}`} />
        </button>
      )}
    </div>
  )
}

function InlineText({
  value,
  placeholder,
  disabled,
  onBlurCommit,
  widthClass,
}: {
  value: string
  placeholder: string
  disabled: boolean
  onBlurCommit: (v: string) => void
  widthClass: string
}) {
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  const [lastExternal, setLastExternal] = useState(value)

  // Sync local to upstream value on prop change — but only when not focused,
  // so we never yank text out from under a user mid-edit.
  if (value !== lastExternal) {
    setLastExternal(value)
    if (!focused) setLocal(value)
  }

  return (
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        onBlurCommit(local)
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={`${widthClass} rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 dark:disabled:bg-gray-900/40 disabled:text-gray-500`}
    />
  )
}
