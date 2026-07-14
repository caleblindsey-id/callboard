'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Minus,
  Plus,
  SkipForward,
  Flag,
  MapPin,
} from 'lucide-react'
import SegmentedControl from '@/components/ui/SegmentedControl'
import InlineError from '@/components/ui/InlineError'
import ScrollableTable from '@/components/ScrollableTable'
import { UrgencyDot, UrgencyBadge, URGENCY_META, reorderUrgency } from '@/components/ReorderStatusBadge'
import { formatMoney } from '@/lib/format'
import type { ReorderSessionRow, ReorderLineRow, ReorderSessionVendorRow } from '@/types/reorder'
import type { ReorderUrgency } from '@/lib/reorder/suggest'

interface ReorderWalkProps {
  session: ReorderSessionRow
  initialLines: ReorderLineRow[]
  vendors: ReorderSessionVendorRow[]
  currentUserId: string
}

type ViewMode = 'card' | 'table'
type SortMode = 'walk' | 'urgent' | 'vendor'
type SaveState = 'saving' | 'saved' | 'error'

const URGENCY_RANK: Record<ReorderUrgency, number> = { red: 0, amber: 1, green: 2, grey: 3 }

// Pure sort/filter helpers, module-level (no closures needed) so they're
// trivially reusable by both card and table mode.
function compareByWalkOrder(a: ReorderLineRow, b: ReorderLineRow): number {
  const ak = a.sort_key ?? ''
  const bk = b.sort_key ?? ''
  if (ak !== bk) return ak < bk ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function compareByUrgency(a: ReorderLineRow, b: ReorderLineRow): number {
  const diff = URGENCY_RANK[reorderUrgency(a)] - URGENCY_RANK[reorderUrgency(b)]
  return diff !== 0 ? diff : compareByWalkOrder(a, b)
}

function compareByVendor(a: ReorderLineRow, b: ReorderLineRow): number {
  const an = a.vendor_name ?? ''
  const bn = b.vendor_name ?? ''
  if (an !== bn) {
    if (!an) return 1
    if (!bn) return -1
    return an < bn ? -1 : 1
  }
  return compareByWalkOrder(a, b)
}

function lineMatchesFilter(line: ReorderLineRow, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'below_rop') {
    return (line.order_point ?? 0) > 0 && (line.available ?? 0) <= (line.order_point ?? 0)
  }
  if (filter === 'has_usage') return (line.weekly_usage ?? 0) > 0
  if (filter.startsWith('vendor:')) {
    return String(line.vendor_code ?? '') === filter.slice('vendor:'.length)
  }
  return true
}

function lineLabel(line: ReorderLineRow): string {
  return line.description ?? line.synergy_product_id
}

// Module-level per wiki/feedback/no-inner-components.md — defining these
// inside ReorderWalk would remount (and drop focus from) the qty inputs on
// every keystroke-driven re-render.

function DecisionStat({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`text-base ${emphasis ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
        {value}
      </p>
    </div>
  )
}

function SaveIndicator({ state }: { state?: SaveState }) {
  if (!state) return null
  if (state === 'saving') return <span className="text-xs text-gray-400 dark:text-gray-500">Saving…</span>
  if (state === 'saved') return <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
  return <span className="text-xs text-red-600 dark:text-red-400">Not saved — check connection</span>
}

function FlagEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10 p-3 space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Flag note</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Why is this flagged?"
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="px-3 py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700"
        >
          Save Flag
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function ReorderWalk({ session, initialLines, vendors }: ReorderWalkProps) {
  const router = useRouter()

  const [lines, setLines] = useState<ReorderLineRow[]>(initialLines)
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [sortMode, setSortMode] = useState<SortMode>('walk')
  const [filterMode, setFilterMode] = useState('all')
  const [cardIndex, setCardIndex] = useState(0)
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const [flagOpenId, setFlagOpenId] = useState<string | null>(null)
  const [flagDraft, setFlagDraft] = useState('')
  const [sessionError, setSessionError] = useState<string | null>(null)

  const qtyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startedRef = useRef(false)

  // Start the walk: draft -> walking on first mount/interaction. router.refresh()
  // re-fetches the server page so the header's ReorderStatusBadge (rendered in
  // page.tsx, not here) picks up the new status without a full reload.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (session.status !== 'draft') return
    fetch(`/api/purchasing/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'walking' }),
    })
      .then((res) => {
        if (res.ok) router.refresh()
      })
      .catch(() => {
        setSessionError('Could not start the walk (status stayed in Draft) — your entries still save.')
      })
  }, [session.id, session.status, router])

  // Clear any pending debounced qty saves on unmount.
  useEffect(() => {
    const timers = qtyTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  async function persistLine(lineId: string, patch: Partial<Pick<ReorderLineRow, 'order_qty' | 'line_status' | 'flag_note'>>) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)))
    setSaveState((s) => ({ ...s, [lineId]: 'saving' }))
    try {
      const res = await fetch(`/api/purchasing/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...data } : l)))
      setSaveState((s) => ({ ...s, [lineId]: 'saved' }))
      setTimeout(() => {
        setSaveState((s) => {
          if (s[lineId] !== 'saved') return s
          const next = { ...s }
          delete next[lineId]
          return next
        })
      }, 2000)
    } catch {
      setSaveState((s) => ({ ...s, [lineId]: 'error' }))
    }
  }

  function qtyInputValue(line: ReorderLineRow): string {
    return qtyInputs[line.id] ?? String(line.order_qty)
  }

  // Setting a qty > 0 sets line_status 'ordered'; clearing to 0 sets 'pending' —
  // sent alongside order_qty in the same PATCH so the two can never drift.
  function commitQty(line: ReorderLineRow, qty: number) {
    const clamped = Math.max(0, Math.round(qty))
    setQtyInputs((prev) => ({ ...prev, [line.id]: String(clamped) }))
    persistLine(line.id, { order_qty: clamped, line_status: clamped > 0 ? 'ordered' : 'pending' })
  }

  function handleQtyChange(line: ReorderLineRow, raw: string) {
    setQtyInputs((prev) => ({ ...prev, [line.id]: raw }))
    const timers = qtyTimers.current
    const existing = timers.get(line.id)
    if (existing) clearTimeout(existing)
    timers.set(
      line.id,
      setTimeout(() => {
        const parsed = parseInt(raw, 10)
        commitQty(line, Number.isFinite(parsed) ? parsed : 0)
        timers.delete(line.id)
      }, 500)
    )
  }

  function handleStep(line: ReorderLineRow, delta: number) {
    const parsed = parseInt(qtyInputValue(line), 10)
    const base = Number.isFinite(parsed) ? parsed : line.order_qty
    commitQty(line, base + delta)
  }

  function handleSkip(line: ReorderLineRow) {
    persistLine(line.id, { line_status: 'skipped' })
    goNext()
  }

  function openFlag(line: ReorderLineRow) {
    setFlagOpenId(line.id)
    setFlagDraft(line.flag_note ?? '')
  }

  function cancelFlag() {
    setFlagOpenId(null)
    setFlagDraft('')
  }

  function saveFlag(line: ReorderLineRow) {
    persistLine(line.id, { line_status: 'flagged', flag_note: flagDraft.trim() || null })
    setFlagOpenId(null)
    setFlagDraft('')
  }

  const visibleLines = useMemo(() => {
    const filtered = lines.filter((l) => lineMatchesFilter(l, filterMode))
    const comparator = sortMode === 'urgent' ? compareByUrgency : sortMode === 'vendor' ? compareByVendor : compareByWalkOrder
    return [...filtered].sort(comparator)
  }, [lines, filterMode, sortMode])

  const safeIndex = Math.min(cardIndex, Math.max(visibleLines.length - 1, 0))
  const currentLine = visibleLines[safeIndex] ?? null

  function changeSort(mode: SortMode) {
    setSortMode(mode)
    setCardIndex(0)
  }
  function changeFilter(mode: string) {
    setFilterMode(mode)
    setCardIndex(0)
  }
  function goPrev() {
    setCardIndex(Math.max(0, safeIndex - 1))
  }
  function goNext() {
    setCardIndex(Math.min(visibleLines.length - 1, safeIndex + 1))
  }

  // Recomputed client-side for instant feedback on every keystroke/tap — matches
  // the server's recomputeSessionRollups formula exactly (order_qty * pack_qty *
  // unit_cost, null pack_qty -> 1, null unit_cost -> 0) so it can't drift. The
  // session's own lines_ordered/est_total_cost columns are the server-authoritative
  // numbers surfaced on the list page and the (P4) review page.
  const orderedCount = lines.filter((l) => l.order_qty > 0).length
  const estTotal = lines.reduce(
    (sum, l) => sum + (l.order_qty > 0 ? l.order_qty * (l.pack_qty ?? 1) * (l.unit_cost ?? 0) : 0),
    0
  )

  return (
    <div className="space-y-4">
      {sessionError && <InlineError message={sessionError} />}

      {/* Progress + totals + review */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {visibleLines.length > 0
              ? viewMode === 'card'
                ? `Item ${safeIndex + 1} of ${visibleLines.length}`
                : `${visibleLines.length} item${visibleLines.length === 1 ? '' : 's'}`
              : 'No items'}
          </p>
          {viewMode === 'card' && currentLine?.bin_location && (
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Bin {currentLine.bin_location}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{orderedCount} ordered</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{formatMoney(estTotal)} est.</p>
        </div>
        <Link
          href={`/purchasing/${session.id}/review`}
          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 dark:bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-slate-600 lg:min-h-0"
        >
          Review
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Mode / sort / filter controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="w-full lg:w-auto">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">View</span>
          <SegmentedControl
            ariaLabel="View mode"
            options={[
              { value: 'card', label: 'Card' },
              { value: 'table', label: 'Table' },
            ]}
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
          />
        </div>
        <div className="w-full lg:w-auto">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sort</label>
          <select
            value={sortMode}
            onChange={(e) => changeSort(e.target.value as SortMode)}
            className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="walk">Walk order</option>
            <option value="urgent">Most urgent first</option>
            <option value="vendor">By vendor</option>
          </select>
        </div>
        <div className="w-full lg:w-auto">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Filter</label>
          <select
            value={filterMode}
            onChange={(e) => changeFilter(e.target.value)}
            className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="all">All items</option>
            <option value="below_rop">Below reorder point</option>
            <option value="has_usage">Has usage</option>
            {vendors.length > 0 && (
              <optgroup label="Vendor">
                {vendors.map((v) => (
                  <option key={v.vendor_code} value={`vendor:${v.vendor_code}`}>
                    {v.vendor_name ?? `Vendor ${v.vendor_code}`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {visibleLines.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No items match the current filter.
        </div>
      ) : viewMode === 'card' && currentLine ? (
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className={`h-2 ${URGENCY_META[reorderUrgency(currentLine)].dotClasses}`} />
            <div className="p-4 sm:p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{currentLine.synergy_product_id}</p>
                  <h2 className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white leading-snug">
                    {lineLabel(currentLine)}
                  </h2>
                </div>
                <UrgencyBadge urgency={reorderUrgency(currentLine)} className="shrink-0" />
              </div>

              <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <MapPin className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                <span className="text-lg font-semibold text-gray-900 dark:text-white">
                  {currentLine.bin_location ?? 'No bin on file'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-gray-100 dark:border-gray-700">
                <DecisionStat label="On Hand" value={currentLine.qoh ?? '—'} />
                <DecisionStat label="On Order" value={currentLine.on_order ?? '—'} />
                <DecisionStat label="Committed" value={currentLine.committed ?? '—'} />
                <DecisionStat label="Available" value={currentLine.available ?? '—'} emphasis />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <DecisionStat
                  label="Weekly Usage"
                  value={currentLine.weekly_usage != null ? currentLine.weekly_usage.toFixed(1) : '—'}
                />
                <DecisionStat
                  label="Weeks of Supply"
                  value={currentLine.weeks_of_supply != null ? currentLine.weeks_of_supply.toFixed(1) : '—'}
                />
                <DecisionStat label="Order Point" value={currentLine.order_point ?? '—'} />
                <DecisionStat label="Max Level" value={currentLine.max_level ?? '—'} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DecisionStat label="Vendor" value={currentLine.vendor_name ?? '—'} />
                <DecisionStat label="Vendor Item #" value={currentLine.vendor_item_number ?? '—'} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <DecisionStat label="Buying UOM" value={currentLine.buying_uom ?? '—'} />
                <DecisionStat label="Pack Qty" value={currentLine.pack_qty ?? 1} />
                <DecisionStat label="Unit Cost" value={formatMoney(currentLine.unit_cost)} />
              </div>

              {/* Qty entry — in cases (the buying UOM) */}
              <div className="rounded-lg bg-slate-50 dark:bg-gray-900/40 border border-slate-200 dark:border-gray-700 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="reorder-qty-input">
                    Order Qty ({currentLine.buying_uom || 'cases'})
                  </label>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    Suggested: {currentLine.suggested_qty ?? 0}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleStep(currentLine, -1)}
                    aria-label={`Decrease quantity for ${lineLabel(currentLine)}`}
                    className="h-12 w-12 shrink-0 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Minus className="h-5 w-5" />
                  </button>
                  <input
                    id="reorder-qty-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={qtyInputValue(currentLine)}
                    onChange={(e) => handleQtyChange(currentLine, e.target.value)}
                    className="w-full text-center text-2xl font-semibold rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white py-3 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleStep(currentLine, 1)}
                    aria-label={`Increase quantity for ${lineLabel(currentLine)}`}
                    className="h-12 w-12 shrink-0 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Extended:{' '}
                    {formatMoney(
                      (parseInt(qtyInputValue(currentLine), 10) || 0) *
                        (currentLine.pack_qty ?? 1) *
                        (currentLine.unit_cost ?? 0)
                    )}
                  </span>
                  <SaveIndicator state={saveState[currentLine.id]} />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => handleSkip(currentLine)}
                  className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <SkipForward className="h-4 w-4" />
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => (flagOpenId === currentLine.id ? cancelFlag() : openFlag(currentLine))}
                  className={`min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-colors ${
                    currentLine.line_status === 'flagged'
                      ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300'
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <Flag className="h-4 w-4" />
                  {currentLine.line_status === 'flagged' ? 'Flagged' : 'Flag'}
                </button>
              </div>

              {flagOpenId === currentLine.id && (
                <FlagEditor
                  value={flagDraft}
                  onChange={setFlagDraft}
                  onSave={() => saveFlag(currentLine)}
                  onCancel={cancelFlag}
                />
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={goPrev}
              disabled={safeIndex === 0}
              className="min-h-[52px] flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-5 w-5" />
              Prev
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={safeIndex >= visibleLines.length - 1}
              className="min-h-[52px] flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 dark:bg-slate-700 text-white font-medium disabled:opacity-40 hover:bg-slate-800 dark:hover:bg-slate-600"
            >
              Next
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <ScrollableTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <th className="px-3 py-2 text-left w-8" aria-label="Urgency"></th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Bin</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Product</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Vendor</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">On Hand</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">On Order</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Committed</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Available</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Wkly Usage</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">WOS</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Order Pt</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">UOM</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Suggested</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Order Qty</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Unit Cost</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Extended</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visibleLines.map((line) => {
                  const urgency = reorderUrgency(line)
                  const qty = parseInt(qtyInputValue(line), 10) || 0
                  const extended = qty * (line.pack_qty ?? 1) * (line.unit_cost ?? 0)
                  return (
                    <Fragment key={line.id}>
                      <tr className={line.id === currentLine?.id ? 'bg-slate-50 dark:bg-slate-800/40' : ''}>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center" title={URGENCY_META[urgency].label}>
                            <UrgencyDot urgency={urgency} />
                            <span className="sr-only">{URGENCY_META[urgency].label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{line.bin_location ?? '—'}</td>
                        <td className="px-3 py-2 max-w-[16rem]">
                          <div className="truncate text-gray-700 dark:text-gray-300">{lineLabel(line)}</div>
                          <div className="text-xs text-gray-400 dark:text-gray-500">{line.synergy_product_id}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{line.vendor_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{line.qoh ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{line.on_order ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{line.committed ?? '—'}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{line.available ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                          {line.weekly_usage != null ? line.weekly_usage.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                          {line.weeks_of_supply != null ? line.weeks_of_supply.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{line.order_point ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{line.buying_uom ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{line.suggested_qty ?? 0}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleStep(line, -1)}
                              aria-label={`Decrease quantity for ${lineLabel(line)}`}
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={qtyInputValue(line)}
                              onChange={(e) => handleQtyChange(line, e.target.value)}
                              aria-label={`Order quantity for ${lineLabel(line)}`}
                              className="w-16 text-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleStep(line, 1)}
                              aria-label={`Increase quantity for ${lineLabel(line)}`}
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatMoney(line.unit_cost)}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{formatMoney(extended)}</td>
                        <td className="px-3 py-2">
                          <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">{line.line_status}</div>
                          <SaveIndicator state={saveState[line.id]} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => persistLine(line.id, { line_status: 'skipped' })}
                              aria-label={`Skip ${lineLabel(line)}`}
                              className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <SkipForward className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => (flagOpenId === line.id ? cancelFlag() : openFlag(line))}
                              aria-label={`Flag ${lineLabel(line)}`}
                              className={`h-7 w-7 inline-flex items-center justify-center rounded border hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                line.line_status === 'flagged'
                                  ? 'border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400'
                                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                              }`}
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {flagOpenId === line.id && (
                        <tr>
                          <td colSpan={18} className="px-3 py-2 bg-orange-50/50 dark:bg-orange-900/5">
                            <FlagEditor
                              value={flagDraft}
                              onChange={setFlagDraft}
                              onSave={() => saveFlag(line)}
                              onCancel={cancelFlag}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      )}
    </div>
  )
}
