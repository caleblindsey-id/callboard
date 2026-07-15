'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Search,
  ScanLine,
  X,
} from 'lucide-react'
import SegmentedControl from '@/components/ui/SegmentedControl'
import InlineError from '@/components/ui/InlineError'
import ScrollableTable from '@/components/ScrollableTable'
import { UrgencyDot, UrgencyBadge, URGENCY_META, reorderUrgency } from '@/components/ReorderStatusBadge'
import { formatMoney } from '@/lib/format'
import { useOfflineQueue, type QueuedLineMutation } from '@/lib/hooks/useOfflineQueue'
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
// 'queued' = entered while offline (or the PATCH itself failed to reach the
// server) and persisted to the IndexedDB-backed offline queue; cleared once
// that mutation successfully flushes. See useOfflineQueue.
type SaveState = 'saving' | 'saved' | 'queued' | 'error'

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

function comparatorForSort(mode: SortMode): (a: ReorderLineRow, b: ReorderLineRow) => number {
  return mode === 'urgent' ? compareByUrgency : mode === 'vendor' ? compareByVendor : compareByWalkOrder
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

// Free-text search matching (P3, Task 3.1) — runs entirely against the
// lines already loaded in React state, so it works offline with no API
// round-trip. product # / description are contains-matches; bin is a
// prefix match (covers both an exact bin and typing just the zone/bay);
// barcode is an exact match (scanning a UPC should not fuzzy-match).
function lineMatchesSearch(line: ReorderLineRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  if (line.synergy_product_id.toLowerCase().includes(q)) return true
  if (line.description && line.description.toLowerCase().includes(q)) return true
  if (line.bin_location && line.bin_location.toLowerCase().startsWith(q)) return true
  if (line.barcode && line.barcode.toLowerCase() === q) return true
  return false
}

// Scan-to-jump matching (P3, Task 3.2) — a scanned value is always an exact
// read (a UPC or a printed bin label), so this is exact-match only, checked
// in priority order: barcode first (a product UPC), then bin_location (a bin
// label), then the product # itself (in case a shelf tag encodes it).
function matchScannedValue(lines: ReorderLineRow[], raw: string): ReorderLineRow | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  return (
    lines.find((l) => l.barcode && l.barcode.toLowerCase() === value) ??
    lines.find((l) => l.bin_location && l.bin_location.toLowerCase() === value) ??
    lines.find((l) => l.synergy_product_id.toLowerCase() === value) ??
    null
  )
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
  if (state === 'queued') {
    return <span className="text-xs text-amber-600 dark:text-amber-400">Queued — will sync when back online</span>
  }
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

// Module-level (no-inner-components) — wraps the search input, which would
// otherwise remount and drop focus on every keystroke if defined inside
// ReorderWalk's body.
function SearchPanel({
  query,
  onQueryChange,
  onSubmit,
  onScanClick,
}: {
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onScanClick: () => void
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3 flex flex-col sm:flex-row gap-2">
      <form
        role="search"
        className="flex-1 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search product #, description, or bin…"
          aria-label="Search reorder walk items"
          className="min-h-[44px] flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
        <button
          type="submit"
          className="min-h-[44px] shrink-0 inline-flex items-center gap-1.5 rounded-md bg-slate-900 dark:bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-slate-600"
        >
          <Search className="h-4 w-4" />
          Go
        </button>
      </form>
      <button
        type="button"
        onClick={onScanClick}
        aria-label="Scan barcode or bin label"
        className="min-h-[44px] shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <ScanLine className="h-4 w-4" />
        Scan
      </button>
    </div>
  )
}

// Live "as you type" result list, shown below SearchPanel. Clicking a result
// jumps straight to that line (see jumpToLine).
function SearchResults({
  matches,
  onPick,
}: {
  matches: ReorderLineRow[]
  onPick: (line: ReorderLineRow) => void
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
      {matches.map((line) => (
        <button
          key={line.id}
          type="button"
          onClick={() => onPick(line)}
          className="w-full min-h-[44px] flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <span className="min-w-0">
            <span className="block font-medium text-gray-900 dark:text-white truncate">{lineLabel(line)}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {line.synergy_product_id}
              {line.bin_location ? ` · Bin ${line.bin_location}` : ''}
            </span>
          </span>
          <UrgencyDot urgency={reorderUrgency(line)} />
        </button>
      ))}
    </div>
  )
}

type ScannerStatus = 'starting' | 'scanning' | 'unsupported' | 'denied' | 'error'

// Camera barcode scanner. Uses the native BarcodeDetector API where available
// (no dependency added); when it's unavailable this shows a plain fallback
// message rather than pulling in a library (html5-qrcode would be the
// future optional add for a non-Chromium tablet fleet — deliberately not
// added here per scope). Always stops its own camera stream on unmount/close
// so no track is left running in the background.
function ScannerModal({ onDetect, onClose }: { onDetect: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [status, setStatus] = useState<ScannerStatus>('starting')

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        setStatus('unsupported')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setStatus('scanning')
        // BarcodeDetector isn't in TS's lib.dom.d.ts yet — feature-detected
        // above via `in window`; the cast is local to this construction.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const DetectorCtor = (window as any).BarcodeDetector
        const detector = new DetectorCtor({
          formats: ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code'],
        })

        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) {
              onDetect(codes[0].rawValue)
              return // parent closes the modal on detect; no need to keep looping
            }
          } catch {
            // Transient per-frame detect() failure — keep trying.
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        if (cancelled) return
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          setStatus('denied')
        } else {
          setStatus('error')
        }
      }
    }

    start()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Scan barcode or bin label">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-sm w-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Scan barcode or bin label</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {status === 'unsupported' && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Camera scanning not supported on this device — use search instead.
            </p>
          )}
          {status === 'denied' && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Camera access was denied. Allow camera access to scan, or use search instead.
            </p>
          )}
          {status === 'error' && (
            <p className="text-sm text-gray-600 dark:text-gray-300">Couldn&apos;t start the camera. Use search instead.</p>
          )}
          {(status === 'starting' || status === 'scanning') && (
            <video ref={videoRef} className="w-full rounded-md bg-black aspect-video" muted playsInline />
          )}
          {status === 'scanning' && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">Point the camera at a barcode or bin label</p>
          )}
        </div>
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

  // Search + scan-to-jump (P3)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSubmitted, setSearchSubmitted] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const qtyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startedRef = useRef(false)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  const appliedInitialQueueRef = useRef(false)

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

  // Sends one queued mutation's PATCH and reconciles the server's returned
  // row into local state on success — shared by the direct-edit path below
  // and the offline queue's auto-flush (useOfflineQueue's onFlush). Throws
  // on any non-2xx response or network failure so the caller (either
  // persistLine or the queue's flush loop) decides what to do with the
  // failure; this function only knows how to send + reconcile.
  const sendLinePatch = useCallback(async (lineId: string, patch: QueuedLineMutation['patch']) => {
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
  }, [])

  const offlineQueue = useOfflineQueue({
    sessionId: session.id,
    onFlush: async (mutation) => {
      await sendLinePatch(mutation.lineId, mutation.patch)
    },
  })

  // Reconcile any mutations already queued in IndexedDB (e.g. the page
  // reloaded mid-dead-zone before they flushed) back onto the visible
  // lines/qty inputs and mark them 'queued' — otherwise the walk would
  // silently show the last server-synced value instead of the agent's
  // unsaved entry until the next auto-flush tick. Runs once, when the queue
  // finishes its initial IndexedDB load (see the eslint note in
  // useOfflineQueue.ts — the equivalent render-time pattern here would need
  // to read `appliedInitialQueueRef` during render, which trips
  // `react-hooks/refs`, so this stays a plain effect like the rest of the
  // file's mount-time effects).
  useEffect(() => {
    if (!offlineQueue.ready || appliedInitialQueueRef.current) return
    appliedInitialQueueRef.current = true
    if (offlineQueue.queuedByLineId.size === 0) return
    setLines((prev) =>
      prev.map((l) => {
        const queued = offlineQueue.queuedByLineId.get(l.id)
        return queued ? { ...l, ...queued.patch } : l
      })
    )
    setQtyInputs((prev) => {
      const next = { ...prev }
      offlineQueue.queuedByLineId.forEach((mutation, lineId) => {
        if (mutation.patch.order_qty !== undefined) next[lineId] = String(mutation.patch.order_qty)
      })
      return next
    })
    setSaveState((prev) => {
      const next = { ...prev }
      offlineQueue.queuedByLineId.forEach((_mutation, lineId) => {
        next[lineId] = 'queued'
      })
      return next
    })
  }, [offlineQueue.ready, offlineQueue.queuedByLineId])

  async function persistLine(lineId: string, patch: QueuedLineMutation['patch']) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)))

    // Known offline — don't even attempt the round-trip, go straight to the
    // queue so the UI doesn't sit in "Saving…" waiting on a request that
    // can't complete.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSaveState((s) => ({ ...s, [lineId]: 'queued' }))
      offlineQueue.enqueue(lineId, patch)
      return
    }

    setSaveState((s) => ({ ...s, [lineId]: 'saving' }))
    try {
      await sendLinePatch(lineId, patch)
    } catch (err) {
      // A thrown fetch (network unreachable — the dead-zone case, `!res.ok`
      // never even ran) queues for later. A response the server actually
      // returned (validation/permission/500) is a real error, not an offline
      // gap, so it surfaces immediately rather than retrying silently forever.
      if (err instanceof TypeError) {
        setSaveState((s) => ({ ...s, [lineId]: 'queued' }))
        offlineQueue.enqueue(lineId, patch)
      } else {
        setSaveState((s) => ({ ...s, [lineId]: 'error' }))
      }
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
    return [...filtered].sort(comparatorForSort(sortMode))
  }, [lines, filterMode, sortMode])

  const safeIndex = Math.min(cardIndex, Math.max(visibleLines.length - 1, 0))
  const currentLine = visibleLines[safeIndex] ?? null

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return []
    return lines.filter((l) => lineMatchesSearch(l, searchQuery)).slice(0, 8)
  }, [lines, searchQuery])

  // Jump to any line by search/scan — always reachable regardless of the
  // active filter or view mode. If the target is filtered out under the
  // current filter, drop back to "all" first (computed locally, not from
  // React state, so the position below is consistent within this call
  // rather than racing the async setFilterMode). Card mode re-renders around
  // the new cardIndex; table mode also scrolls the row into view since it
  // doesn't re-render around a "current" position the way card mode does.
  function jumpToLine(line: ReorderLineRow) {
    const targetFilter = lineMatchesFilter(line, filterMode) ? filterMode : 'all'
    if (targetFilter !== filterMode) setFilterMode(targetFilter)
    const ordered = lines.filter((l) => lineMatchesFilter(l, targetFilter)).sort(comparatorForSort(sortMode))
    const idx = ordered.findIndex((l) => l.id === line.id)
    if (idx >= 0) setCardIndex(idx)
    setSearchQuery('')
    setSearchSubmitted(false)
    setScanMessage(null)
    requestAnimationFrame(() => {
      rowRefs.current.get(line.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function handleSearchSubmit() {
    setSearchSubmitted(true)
    if (searchMatches.length > 0) jumpToLine(searchMatches[0])
  }

  function handleScanDetect(value: string) {
    setScannerOpen(false)
    const match = matchScannedValue(lines, value)
    if (match) {
      jumpToLine(match)
    } else {
      setScanMessage(`No item for "${value}"`)
    }
  }

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
        {offlineQueue.pendingCount > 0 && (
          <span
            role="status"
            className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300"
          >
            {offlineQueue.pendingCount} pending sync
          </span>
        )}
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

      {/* Search + scan-to-jump (P3) — available in both card and table mode */}
      <SearchPanel
        query={searchQuery}
        onQueryChange={(v) => {
          setSearchQuery(v)
          setSearchSubmitted(false)
        }}
        onSubmit={handleSearchSubmit}
        onScanClick={() => {
          setScanMessage(null)
          setScannerOpen(true)
        }}
      />
      {searchQuery.trim() && searchMatches.length > 0 && (
        <SearchResults matches={searchMatches} onPick={jumpToLine} />
      )}
      {searchSubmitted && searchQuery.trim() && searchMatches.length === 0 && (
        <InlineError message={`No item matches "${searchQuery.trim()}"`} />
      )}
      {scanMessage && <InlineError message={scanMessage} onRetry={() => setScanMessage(null)} retryLabel="Dismiss" />}
      {scannerOpen && <ScannerModal onDetect={handleScanDetect} onClose={() => setScannerOpen(false)} />}

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
                      <tr
                        ref={(el) => {
                          if (el) rowRefs.current.set(line.id, el)
                          else rowRefs.current.delete(line.id)
                        }}
                        className={line.id === currentLine?.id ? 'bg-slate-50 dark:bg-slate-800/40' : ''}
                      >
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
