'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Clipboard, Download, FileText, Minus, Plus, X } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import { formatMoney } from '@/lib/format'
import type {
  ReorderSessionRow,
  ReorderLineRow,
  ReorderSessionVendorRow,
  InvVendorRow,
} from '@/types/reorder'
import { REORDER_VALID_TRANSITIONS } from '@/types/reorder'

interface ReorderReviewProps {
  session: ReorderSessionRow
  initialLines: ReorderLineRow[]
  initialSessionVendors: ReorderSessionVendorRow[]
  vendorMasters: InvVendorRow[]
  buyerName: string | null
  currentUserId: string
}

type SaveState = 'saving' | 'saved' | 'error'
type ExportFormat = 'pdf' | 'csv'

interface VendorGroup {
  vendorCode: number | null
  vendorName: string
  lines: ReorderLineRow[]
  subtotal: number
  master: InvVendorRow | null
  sessionVendor: ReorderSessionVendorRow | null
}

// ============================================================
// Pure helpers (module-level — no closures needed)
// ============================================================

function caseCost(line: ReorderLineRow): number {
  return (line.pack_qty ?? 1) * (line.unit_cost ?? 0)
}

// Matches recomputeSessionRollups exactly (order_qty * pack_qty * unit_cost,
// null pack_qty -> 1, null unit_cost -> 0) so the on-screen subtotal can
// never disagree with what the server persists on the next line PATCH.
function lineExtended(line: ReorderLineRow, qty?: number): number {
  const q = qty ?? line.order_qty
  return q * (line.pack_qty ?? 1) * (line.unit_cost ?? 0)
}

function lineLabel(line: ReorderLineRow): string {
  return line.description ?? line.synergy_product_id
}

// Groups the ordered (order_qty > 0) lines by vendor_code. Lines with no
// vendor_code (no preferred vendor on file) bucket under vendorCode: null
// and sort last — they can't produce a keyable PO worksheet.
function buildVendorGroups(
  lines: ReorderLineRow[],
  sessionVendors: ReorderSessionVendorRow[],
  masterMap: Map<number, InvVendorRow>
): VendorGroup[] {
  const byVendor = new Map<number | null, ReorderLineRow[]>()
  for (const line of lines) {
    if (line.order_qty <= 0) continue
    const key = line.vendor_code
    const arr = byVendor.get(key) ?? []
    arr.push(line)
    byVendor.set(key, arr)
  }

  const groups: VendorGroup[] = []
  for (const [vendorCode, groupLines] of byVendor.entries()) {
    const subtotal = groupLines.reduce((sum, l) => sum + lineExtended(l), 0)
    const sessionVendor =
      vendorCode != null ? sessionVendors.find((v) => v.vendor_code === vendorCode) ?? null : null
    const master = vendorCode != null ? masterMap.get(vendorCode) ?? null : null
    const vendorName =
      vendorCode == null
        ? 'No preferred vendor'
        : groupLines[0].vendor_name ?? sessionVendor?.vendor_name ?? master?.name ?? `Vendor ${vendorCode}`
    groups.push({ vendorCode, vendorName, lines: groupLines, subtotal, master, sessionVendor })
  }

  groups.sort((a, b) => {
    if (a.vendorCode == null) return 1
    if (b.vendorCode == null) return -1
    return a.vendorName.localeCompare(b.vendorName)
  })
  return groups
}

// Pulls the filename out of a fetch Response's Content-Disposition header
// (falling back to a generic name) and triggers a browser download — shared
// by the per-vendor and export-all PDF/CSV buttons.
async function downloadResponse(res: Response, fallbackFilename: string) {
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] ?? fallbackFilename
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function buildClipboardText(group: VendorGroup): string {
  const header = [
    'Product #',
    'Description',
    'Order Qty',
    'UOM',
    'Vendor Item #',
    'Unit Cost',
    'Case Cost',
    'Extended',
    'Bin',
    'Note',
  ]
  const rows = group.lines.map((line) => [
    line.synergy_product_id,
    lineLabel(line),
    String(line.order_qty),
    line.buying_uom ?? '',
    line.vendor_item_number ?? '',
    line.unit_cost != null ? line.unit_cost.toFixed(2) : '',
    caseCost(line).toFixed(2),
    lineExtended(line).toFixed(2),
    line.bin_location ?? '',
    line.flag_note ?? '',
  ])
  return [header, ...rows].map((row) => row.join('\t')).join('\n')
}

// ============================================================
// Module-level subcomponents — per wiki/feedback/no-inner-components.md,
// defining these inside ReorderReview would remount (and drop focus from)
// the qty/PO#/notes inputs on every keystroke-driven re-render.
// ============================================================

function SaveIndicator({ state }: { state?: SaveState }) {
  if (!state) return null
  if (state === 'saving') return <span className="text-xs text-gray-400 dark:text-gray-500">Saving…</span>
  if (state === 'saved') return <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
  return <span className="text-xs text-red-600 dark:text-red-400">Not saved, check connection</span>
}

function OrderMinBadge({ minimum, subtotal }: { minimum: number | null; subtotal: number }) {
  if (minimum == null || minimum <= 0) return null
  const met = subtotal >= minimum
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        met
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      }`}
    >
      {met ? 'Minimum met' : `Below minimum (${formatMoney(subtotal)} of ${formatMoney(minimum)})`}
    </span>
  )
}

interface VendorGroupSectionProps {
  group: VendorGroup
  qtyInputValue: (line: ReorderLineRow) => string
  onQtyChange: (line: ReorderLineRow, raw: string) => void
  onStep: (line: ReorderLineRow, delta: number) => void
  onRemove: (line: ReorderLineRow) => void
  lineSaveState: Record<string, SaveState>
  poDraft: string
  onPoChange: (vendorCode: number, value: string) => void
  notesDraft: string
  onNotesChange: (vendorCode: number, value: string) => void
  vendorSaveState?: SaveState
  onExport: (vendorCode: number, format: ExportFormat) => void
  onCopy: (group: VendorGroup) => void
  exportBusy: boolean
  copyMessage: string | null
}

function VendorGroupSection({
  group,
  qtyInputValue,
  onQtyChange,
  onStep,
  onRemove,
  lineSaveState,
  poDraft,
  onPoChange,
  notesDraft,
  onNotesChange,
  vendorSaveState,
  onExport,
  onCopy,
  exportBusy,
  copyMessage,
}: VendorGroupSectionProps) {
  const vendorCode = group.vendorCode

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {group.vendorName}
            {vendorCode != null && (
              <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">#{vendorCode}</span>
            )}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {group.lines.length} line{group.lines.length === 1 ? '' : 's'}, {formatMoney(group.subtotal)}
          </p>
        </div>
        {vendorCode != null && (
          <OrderMinBadge minimum={group.master?.order_minimum ?? null} subtotal={group.subtotal} />
        )}
      </div>

      {vendorCode == null && (
        <div className="px-4 pt-3">
          <InlineError message="These lines have no preferred vendor on file, so they can't be exported as a PO worksheet. Assign a vendor in Synergy, or key them manually." />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Bin</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Product</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Order Qty</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">UOM</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Unit Cost</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Case Cost</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Extended</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Note</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400" aria-label="Remove" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {group.lines.map((line) => {
              const qty = parseInt(qtyInputValue(line), 10) || 0
              return (
                <tr key={line.id}>
                  <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{line.bin_location ?? '—'}</td>
                  <td className="px-3 py-2 max-w-[16rem]">
                    <div className="truncate text-gray-700 dark:text-gray-300">{lineLabel(line)}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{line.synergy_product_id}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onStep(line, -1)}
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
                        onChange={(e) => onQtyChange(line, e.target.value)}
                        aria-label={`Order quantity for ${lineLabel(line)}`}
                        className="w-16 text-center rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => onStep(line, 1)}
                        aria-label={`Increase quantity for ${lineLabel(line)}`}
                        className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <SaveIndicator state={lineSaveState[line.id]} />
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{line.buying_uom ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatMoney(line.unit_cost)}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatMoney(caseCost(line))}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">
                    {formatMoney(lineExtended(line, qty))}
                  </td>
                  <td className="px-3 py-2 max-w-[10rem] truncate text-xs text-gray-500 dark:text-gray-400">
                    {line.flag_note ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRemove(line)}
                      aria-label={`Remove ${lineLabel(line)} from the order`}
                      className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {vendorCode != null && (
        <>
          <div className="p-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1" htmlFor={`po-${vendorCode}`}>
                Synergy PO#
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`po-${vendorCode}`}
                  type="text"
                  value={poDraft}
                  onChange={(e) => onPoChange(vendorCode, e.target.value)}
                  placeholder="e.g. 108452"
                  className="min-h-[44px] flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <SaveIndicator state={vendorSaveState} />
              </div>
              {group.sessionVendor?.po_recorded_at && (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Recorded {new Date(group.sessionVendor.po_recorded_at).toLocaleString('en-US')}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1" htmlFor={`notes-${vendorCode}`}>
                Vendor notes
              </label>
              <textarea
                id={`notes-${vendorCode}`}
                value={notesDraft}
                onChange={(e) => onNotesChange(vendorCode, e.target.value)}
                rows={2}
                placeholder="Notes for this vendor's order..."
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => onExport(vendorCode, 'pdf')}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
            >
              <FileText className="h-4 w-4" />
              Export PDF
            </button>
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => onExport(vendorCode, 'csv')}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => onCopy(group)}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 lg:min-h-0 lg:py-1.5"
            >
              <Clipboard className="h-4 w-4" />
              Copy
            </button>
            {copyMessage && <span className="text-xs text-green-600 dark:text-green-400">{copyMessage}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
// Main component
// ============================================================

export default function ReorderReview({
  session,
  initialLines,
  initialSessionVendors,
  vendorMasters,
  buyerName,
}: ReorderReviewProps) {
  const router = useRouter()

  const [lines, setLines] = useState<ReorderLineRow[]>(initialLines)
  const [sessionVendors, setSessionVendors] = useState<ReorderSessionVendorRow[]>(initialSessionVendors)
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({})
  const [lineSaveState, setLineSaveState] = useState<Record<string, SaveState>>({})
  const [poDrafts, setPoDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(initialSessionVendors.map((v) => [v.vendor_code, v.synergy_po_number ?? '']))
  )
  const [notesDrafts, setNotesDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(initialSessionVendors.map((v) => [v.vendor_code, v.notes ?? '']))
  )
  const [vendorSaveState, setVendorSaveState] = useState<Record<number, SaveState>>({})
  const [copyMessages, setCopyMessages] = useState<Record<number, string | null>>({})
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<'ordered' | 'closed' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const qtyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const poTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const notesTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const startedRef = useRef(false)

  // Move walking -> review on first mount. Only from 'walking' (never forces
  // out of 'draft' — an agent reaching this URL before starting the walk
  // shouldn't be silently pushed past it). Mirrors ReorderWalk's draft ->
  // walking effect: the setState that matters lives inside the .then/.catch
  // callback, not synchronously in the effect body, so this doesn't trip
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (session.status !== 'walking') return
    fetch(`/api/purchasing/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review' }),
    })
      .then((res) => {
        if (res.ok) router.refresh()
      })
      .catch(() => {
        setSessionError('Could not move the session to Review automatically, your edits still save.')
      })
  }, [session.id, session.status, router])

  useEffect(() => {
    const qty = qtyTimers.current
    const po = poTimers.current
    const notes = notesTimers.current
    return () => {
      qty.forEach((t) => clearTimeout(t))
      po.forEach((t) => clearTimeout(t))
      notes.forEach((t) => clearTimeout(t))
    }
  }, [])

  const masterMap = useMemo(
    () => new Map(vendorMasters.map((v) => [v.vendor_code, v])),
    [vendorMasters]
  )

  const groups = useMemo(
    () => buildVendorGroups(lines, sessionVendors, masterMap),
    [lines, sessionVendors, masterMap]
  )
  const vendorGroups = useMemo(() => groups.filter((g) => g.vendorCode != null), [groups])
  const unassignedGroup = useMemo(() => groups.find((g) => g.vendorCode == null) ?? null, [groups])

  const sessionTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (l.order_qty > 0 ? lineExtended(l) : 0), 0),
    [lines]
  )
  const orderedLineCount = useMemo(() => lines.filter((l) => l.order_qty > 0).length, [lines])

  const recordedCount = vendorGroups.filter((g) => g.sessionVendor?.synergy_po_number).length
  const totalVendorsWithLines = vendorGroups.length
  const canMarkOrdered = recordedCount >= 1
  const canMarkClosed = totalVendorsWithLines > 0 && vendorGroups.every((g) => g.sessionVendor?.synergy_po_number)
  const canTransitionToOrdered = REORDER_VALID_TRANSITIONS[session.status].includes('ordered')
  const canTransitionToClosed = REORDER_VALID_TRANSITIONS[session.status].includes('closed')

  async function persistLine(lineId: string, patch: { order_qty: number; line_status: 'ordered' | 'pending' }) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)))
    setLineSaveState((s) => ({ ...s, [lineId]: 'saving' }))
    try {
      const res = await fetch(`/api/purchasing/lines/${lineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...data } : l)))
      setLineSaveState((s) => ({ ...s, [lineId]: 'saved' }))
      setTimeout(() => {
        setLineSaveState((s) => {
          if (s[lineId] !== 'saved') return s
          const next = { ...s }
          delete next[lineId]
          return next
        })
      }, 2000)
    } catch {
      setLineSaveState((s) => ({ ...s, [lineId]: 'error' }))
    }
  }

  function qtyInputValue(line: ReorderLineRow): string {
    return qtyInputs[line.id] ?? String(line.order_qty)
  }

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

  function handleRemove(line: ReorderLineRow) {
    commitQty(line, 0)
  }

  async function persistVendor(vendorCode: number, patch: { synergy_po_number?: string | null; notes?: string | null }) {
    setVendorSaveState((s) => ({ ...s, [vendorCode]: 'saving' }))
    try {
      const res = await fetch(`/api/purchasing/sessions/${session.id}/vendors/${vendorCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSessionVendors((prev) => prev.map((v) => (v.vendor_code === vendorCode ? { ...v, ...data } : v)))
      setVendorSaveState((s) => ({ ...s, [vendorCode]: 'saved' }))
      setTimeout(() => {
        setVendorSaveState((s) => {
          if (s[vendorCode] !== 'saved') return s
          const next = { ...s }
          delete next[vendorCode]
          return next
        })
      }, 2000)
    } catch {
      setVendorSaveState((s) => ({ ...s, [vendorCode]: 'error' }))
    }
  }

  function handlePoChange(vendorCode: number, value: string) {
    setPoDrafts((prev) => ({ ...prev, [vendorCode]: value }))
    const timers = poTimers.current
    const existing = timers.get(vendorCode)
    if (existing) clearTimeout(existing)
    timers.set(
      vendorCode,
      setTimeout(() => {
        persistVendor(vendorCode, { synergy_po_number: value.trim() || null })
        timers.delete(vendorCode)
      }, 500)
    )
  }

  function handleNotesChange(vendorCode: number, value: string) {
    setNotesDrafts((prev) => ({ ...prev, [vendorCode]: value }))
    const timers = notesTimers.current
    const existing = timers.get(vendorCode)
    if (existing) clearTimeout(existing)
    timers.set(
      vendorCode,
      setTimeout(() => {
        persistVendor(vendorCode, { notes: value.trim() || null })
        timers.delete(vendorCode)
      }, 500)
    )
  }

  async function handleExport(vendorCode: number | null, format: ExportFormat) {
    setExportBusy(true)
    setExportError(null)
    try {
      const res = await fetch(`/api/purchasing/sessions/${session.id}/worksheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorCode != null ? { format, vendorCode } : { format }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to export worksheet')
      }
      const suffix = vendorCode != null ? `-vendor${vendorCode}` : ''
      await downloadResponse(res, `Reorder-Worksheet-${session.id}${suffix}.${format}`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export worksheet')
    } finally {
      setExportBusy(false)
    }
  }

  function handleCopy(group: VendorGroup) {
    if (group.vendorCode == null) return
    const vendorCode = group.vendorCode
    const text = buildClipboardText(group)
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyMessages((prev) => ({ ...prev, [vendorCode]: 'Copied' }))
        setTimeout(() => setCopyMessages((prev) => ({ ...prev, [vendorCode]: null })), 2000)
      },
      () => {
        setCopyMessages((prev) => ({ ...prev, [vendorCode]: 'Could not copy' }))
      }
    )
  }

  async function handleStatusChange(target: 'ordered' | 'closed') {
    setActionError(null)
    setActionLoading(target)
    try {
      const res = await fetch(`/api/purchasing/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to update session')
      router.refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update session')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      {sessionError && <InlineError message={sessionError} />}
      {exportError && <InlineError message={exportError} onRetry={() => setExportError(null)} retryLabel="Dismiss" />}
      {actionError && <InlineError message={actionError} onRetry={() => setActionError(null)} retryLabel="Dismiss" />}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {orderedLineCount} line{orderedLineCount === 1 ? '' : 's'} across {totalVendorsWithLines} vendor
            {totalVendorsWithLines === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Buyer: {buyerName ?? '—'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/purchasing/${session.id}`}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 lg:min-h-0 lg:py-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to walk
          </Link>
          <button
            type="button"
            disabled={exportBusy || totalVendorsWithLines === 0}
            onClick={() => handleExport(null, 'pdf')}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md bg-slate-900 dark:bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
          >
            <FileText className="h-4 w-4" />
            Export All (PDF)
          </button>
          <button
            type="button"
            disabled={exportBusy || totalVendorsWithLines === 0}
            onClick={() => handleExport(null, 'csv')}
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 lg:min-h-0 lg:py-1.5"
          >
            <Download className="h-4 w-4" />
            Export All (CSV)
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          Nothing ordered yet. Head back to the walk to enter quantities.
        </div>
      ) : (
        <div className="space-y-4">
          {vendorGroups.map((group) => {
            const vendorCode = group.vendorCode as number
            return (
              <VendorGroupSection
                key={vendorCode}
                group={group}
                qtyInputValue={qtyInputValue}
                onQtyChange={handleQtyChange}
                onStep={handleStep}
                onRemove={handleRemove}
                lineSaveState={lineSaveState}
                poDraft={poDrafts[vendorCode] ?? ''}
                onPoChange={handlePoChange}
                notesDraft={notesDrafts[vendorCode] ?? ''}
                onNotesChange={handleNotesChange}
                vendorSaveState={vendorSaveState[vendorCode]}
                onExport={handleExport}
                onCopy={handleCopy}
                exportBusy={exportBusy}
                copyMessage={copyMessages[vendorCode] ?? null}
              />
            )
          })}
          {unassignedGroup && (
            <VendorGroupSection
              key="unassigned"
              group={unassignedGroup}
              qtyInputValue={qtyInputValue}
              onQtyChange={handleQtyChange}
              onStep={handleStep}
              onRemove={handleRemove}
              lineSaveState={lineSaveState}
              poDraft=""
              onPoChange={() => {}}
              notesDraft=""
              onNotesChange={() => {}}
              onExport={handleExport}
              onCopy={handleCopy}
              exportBusy={exportBusy}
              copyMessage={null}
            />
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {recordedCount} of {totalVendorsWithLines} vendor PO{totalVendorsWithLines === 1 ? '' : 's'} recorded
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{formatMoney(sessionTotal)} estimated total</p>
        </div>
        <div className="flex items-center gap-2">
          {canTransitionToOrdered && (
            <button
              type="button"
              disabled={!canMarkOrdered || actionLoading === 'ordered'}
              onClick={() => handleStatusChange('ordered')}
              title={canMarkOrdered ? undefined : 'Record at least one Synergy PO# first'}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md bg-slate-900 dark:bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-slate-600 disabled:opacity-40 lg:min-h-0 lg:py-2"
            >
              <Check className="h-4 w-4" />
              {actionLoading === 'ordered' ? 'Marking Ordered…' : 'Mark Ordered'}
            </button>
          )}
          {canTransitionToClosed && (
            <button
              type="button"
              disabled={!canMarkClosed || actionLoading === 'closed'}
              onClick={() => handleStatusChange('closed')}
              title={canMarkClosed ? undefined : 'Every vendor with ordered lines needs a Synergy PO# recorded'}
              className="min-h-[44px] inline-flex items-center gap-1.5 rounded-md bg-green-700 hover:bg-green-800 px-4 text-sm font-medium text-white disabled:opacity-40 lg:min-h-0 lg:py-2"
            >
              <Check className="h-4 w-4" />
              {actionLoading === 'closed' ? 'Marking Done…' : 'Mark Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
