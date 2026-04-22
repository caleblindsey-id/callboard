'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, XCircle } from 'lucide-react'
import type { PartRequest, PartsQueueRow, PartsQueueSource } from '@/types/database'
import {
  cancelPart,
  markPartOrdered,
  markPartReceived,
  ticketDeepLink,
  updatePartFields,
} from '@/lib/parts-queue'
import CancelPartDialog from './CancelPartDialog'

type Tab = 'to_order' | 'ordered' | 'received'
type SortKey =
  | 'requested_at'
  | 'source'
  | 'work_order_number'
  | 'customer_name'
  | 'description'
  | 'quantity'
  | 'vendor'
  | 'product_number'
  | 'po_number'
  | 'assigned_technician_name'
  | 'ordered_at'
  | 'received_at'

const RECEIVED_WINDOW_DAYS = 14
const RECEIVED_WINDOW_MS = RECEIVED_WINDOW_DAYS * 24 * 60 * 60 * 1000

function rowKey(r: Pick<PartsQueueRow, 'source' | 'ticket_id' | 'part_index'>): string {
  return `${r.source}:${r.ticket_id}:${r.part_index}`
}

function partToRow(row: PartsQueueRow, part: PartRequest): PartsQueueRow {
  return {
    ...row,
    description: part.description ?? row.description,
    quantity: part.quantity ?? row.quantity,
    vendor: part.vendor ?? null,
    product_number: part.product_number ?? null,
    synergy_product_id: part.synergy_product_id ?? null,
    po_number: part.po_number ?? null,
    status: part.status,
    cancelled: part.cancelled ?? false,
    cancel_reason: part.cancel_reason ?? null,
    ordered_at: part.ordered_at ?? null,
    received_at: part.received_at ?? null,
    ordered_by: part.ordered_by ?? null,
    received_by: part.received_by ?? null,
    requested_at: part.requested_at ?? row.requested_at,
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
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

interface Props {
  rows: PartsQueueRow[]
}

export default function PartsQueueClient({ rows: initialRows }: Props) {
  const router = useRouter()
  const [rows, setRows] = useState<PartsQueueRow[]>(initialRows)
  const [tab, setTab] = useState<Tab>('to_order')
  const [sortKey, setSortKey] = useState<SortKey>('requested_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | PartsQueueSource>('all')
  const [vendorFilter, setVendorFilter] = useState('')
  const [pendingRow, setPendingRow] = useState<string | null>(null)
  const [flashedRow, setFlashedRow] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PartsQueueRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const receivedCutoffMs = Date.now() - RECEIVED_WINDOW_MS

  const tabCounts = useMemo(() => {
    let toOrder = 0
    let ordered = 0
    let received = 0
    for (const r of rows) {
      if (r.cancelled) continue
      if (r.status === 'requested') toOrder++
      else if (r.status === 'ordered') ordered++
      else if (r.status === 'received' && r.received_at && new Date(r.received_at).getTime() >= receivedCutoffMs)
        received++
    }
    return { toOrder, ordered, received }
  }, [rows, receivedCutoffMs])

  const vendorOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.vendor) set.add(r.vendor)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const result = rows.filter(r => {
      if (r.cancelled) return false
      // Tab filter
      if (tab === 'to_order' && r.status !== 'requested') return false
      if (tab === 'ordered' && r.status !== 'ordered') return false
      if (tab === 'received') {
        if (r.status !== 'received') return false
        if (!r.received_at) return false
        if (new Date(r.received_at).getTime() < receivedCutoffMs) return false
      }
      // Source filter
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false
      // Vendor filter
      if (vendorFilter && (r.vendor ?? '') !== vendorFilter) return false
      // Search
      if (q) {
        const hay = [
          r.customer_name,
          r.description,
          r.work_order_number?.toString(),
          r.product_number,
          r.po_number,
          r.vendor,
          r.assigned_technician_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return sortRows(result, sortKey, sortDir)
  }, [rows, tab, sourceFilter, vendorFilter, search, sortKey, sortDir, receivedCutoffMs])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function flash(key: string) {
    setFlashedRow(key)
    window.setTimeout(() => {
      setFlashedRow(cur => (cur === key ? null : cur))
    }, 1200)
  }

  function applyUpdate(row: PartsQueueRow, part: PartRequest) {
    const next = partToRow(row, part)
    setRows(rs => rs.map(r => (rowKey(r) === rowKey(row) ? next : r)))
    flash(rowKey(row))
  }

  async function handleFieldBlur(row: PartsQueueRow, field: keyof PartRequest, value: string) {
    const trimmed = value.trim()
    const current = (row[field as keyof PartsQueueRow] ?? '') as string
    if (trimmed === (current ?? '')) return
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const fields: Partial<PartRequest> = { [field]: trimmed || undefined } as Partial<PartRequest>
      const part = await updatePartFields(row.source, row.ticket_id, row.part_index, fields)
      applyUpdate(row, part)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      router.refresh()
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }

  async function handleMarkOrdered(row: PartsQueueRow) {
    const key = rowKey(row)
    setPendingRow(key)
    setError(null)
    try {
      const part = await markPartOrdered(row.source, row.ticket_id, row.part_index)
      applyUpdate(row, part)
      setTab('ordered')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark ordered')
    } finally {
      setPendingRow(cur => (cur === key ? null : cur))
    }
  }

  async function handleMarkReceived(row: PartsQueueRow) {
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
  }

  async function handleConfirmCancel(reason: string) {
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
  }

  const canEditFields = tab !== 'received'
  const canMarkOrdered = tab === 'to_order'
  const canMarkReceived = tab === 'ordered'
  const canCancel = tab !== 'received'

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <TabButton active={tab === 'to_order'} onClick={() => setTab('to_order')} label="To Order" count={tabCounts.toOrder} />
        <TabButton active={tab === 'ordered'} onClick={() => setTab('ordered')} label="Ordered" count={tabCounts.ordered} />
        <TabButton active={tab === 'received'} onClick={() => setTab('received')} label={`Received (${RECEIVED_WINDOW_DAYS}d)`} count={tabCounts.received} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search customer, WO #, part, PO #…"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value as 'all' | PartsQueueSource)}
          className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        >
          <option value="all">All sources</option>
          <option value="pm">PM only</option>
          <option value="service">Service only</option>
        </select>
        <select
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
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

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <tr>
              <SortHeader label="Requested" colKey="requested_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Source" colKey="source" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="WO #" colKey="work_order_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Customer" colKey="customer_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Part" colKey="description" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Qty" colKey="quantity" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Vendor" colKey="vendor" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Synergy #" colKey="product_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="PO #" colKey="po_number" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Requested by" colKey="assigned_technician_name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              {tab === 'ordered' && (
                <SortHeader label="Ordered" colKey="ordered_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              )}
              {tab === 'received' && (
                <SortHeader label="Received" colKey="received_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              )}
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
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
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-900 dark:text-white">
                      {row.work_order_number ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[200px] truncate" title={row.customer_name ?? ''}>
                      {row.customer_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white max-w-[240px] truncate" title={row.description ?? ''}>
                      {row.description ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.quantity ?? 1}</td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.vendor ?? ''}
                        placeholder="Vendor"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'vendor', v)}
                        widthClass="w-28"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.product_number ?? ''}
                        placeholder="Synergy #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'product_number', v)}
                        widthClass="w-28"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <InlineText
                        value={row.po_number ?? ''}
                        placeholder="PO #"
                        disabled={!canEditFields || isPending}
                        onBlurCommit={v => handleFieldBlur(row, 'po_number', v)}
                        widthClass="w-24"
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[140px] truncate">
                      {row.assigned_technician_name ?? '—'}
                    </td>
                    {tab === 'ordered' && (
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {formatDate(row.ordered_at)}
                      </td>
                    )}
                    {tab === 'received' && (
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {formatDate(row.received_at)}
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
                                ? 'Enter Synergy # first'
                                : !row.po_number?.trim()
                                ? 'Enter PO # first'
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
                            disabled={isPending}
                            onClick={() => handleMarkReceived(row)}
                            className="px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40 transition-colors"
                          >
                            Mark Received
                          </button>
                        )}
                        {canCancel && (
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
                          title="Open ticket"
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

      <CancelPartDialog
        open={!!cancelTarget}
        description={cancelTarget?.description ?? ''}
        onCancel={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
      />
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
    <th className="px-3 py-2 text-left font-semibold">
      <button
        type="button"
        onClick={() => onClick(colKey)}
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
