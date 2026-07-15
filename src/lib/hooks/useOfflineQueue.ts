'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReorderLineRow } from '@/types/reorder'

/**
 * Offline-resilient queue for reorder-walk line edits (P3 — see the design
 * spec's "Offline resilience" section). Scope is deliberately narrow: the
 * realistic failure mode is a mid-walk Wi-Fi dead zone (the walk page was
 * already loaded while online, then connectivity drops), NOT a full
 * offline-first page load — this hook does not attempt a service worker /
 * cached initial load, only resilience for entries made once the walk is
 * already open. Isolated here (per the plan's gotcha #10) so it can't
 * destabilize the rest of ReorderWalk.
 *
 * Backed by raw IndexedDB (no new dependency) rather than localStorage so a
 * queued mutation survives a page reload/crash mid-dead-zone, not just a
 * network blip within the same page session.
 */

export type QueuedLinePatch = Partial<Pick<ReorderLineRow, 'order_qty' | 'line_status' | 'flag_note'>>

export interface QueuedLineMutation {
  lineId: string
  patch: QueuedLinePatch
  /** Epoch ms this mutation was queued/replaced. Also doubles as the
   * "is this still the current queued edit" token used to detect a mutation
   * that was superseded by a newer edit while a flush attempt was in flight. */
  updatedAt: number
}

export interface UseOfflineQueueOptions {
  /** Reorder session id — the queue is namespaced by this so multiple
   * sessions (e.g. resumed on a different device) never mix entries. */
  sessionId: string
  /**
   * Attempt to persist one queued mutation to the server. Resolve on success
   * (the mutation is removed from the queue); throw/reject to leave it
   * queued for the next flush attempt (network still down, or the request
   * itself failed).
   */
  onFlush: (mutation: QueuedLineMutation) => Promise<void>
  /** How often to retry the queue while online, in ms. Default 5000. */
  intervalMs?: number
}

export interface UseOfflineQueueResult {
  /** True once the IndexedDB queue for this session has been loaded, so a
   * caller can avoid flashing "0 pending" before the real count is known
   * (and can safely apply queued edits back onto its own state exactly once). */
  ready: boolean
  /** lineId -> queued mutation, for O(1) "is this line queued" lookups and
   * for reconciling queued edits back onto local line state after a reload. */
  queuedByLineId: Map<string, QueuedLineMutation>
  /** Number of distinct lines with a queued (not yet flushed) mutation. */
  pendingCount: number
  /** Enqueue (or replace, latest-wins) a mutation for a line. Persists to
   * IndexedDB immediately so a reload right after this call doesn't lose it. */
  enqueue: (lineId: string, patch: QueuedLinePatch) => void
  /** Manually trigger a flush attempt. No-ops while offline, already
   * flushing, or with nothing queued. Also runs automatically on the
   * `online` event and on `intervalMs` while online. */
  flushNow: () => void
}

const DB_NAME = 'callboard-reorder-offline-queue'
const DB_VERSION = 1
const STORE_NAME = 'mutations'

interface StoredMutation extends QueuedLineMutation {
  key: string
  sessionId: string
}

function storedKey(sessionId: string, lineId: string): string {
  return `${sessionId}::${lineId}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('sessionId', 'sessionId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open offline-queue IndexedDB'))
  })
}

function getMutationsForSession(db: IDBDatabase, sessionId: string): Promise<StoredMutation[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('sessionId')
    const req = index.getAll(IDBKeyRange.only(sessionId))
    req.onsuccess = () => resolve((req.result as StoredMutation[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('Failed to read offline queue'))
  })
}

function putMutation(db: IDBDatabase, sessionId: string, mutation: QueuedLineMutation): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const record: StoredMutation = { ...mutation, sessionId, key: storedKey(sessionId, mutation.lineId) }
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to persist queued mutation'))
  })
}

function deleteMutation(db: IDBDatabase, sessionId: string, lineId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(storedKey(sessionId, lineId))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to remove flushed mutation'))
  })
}

export function useOfflineQueue({ sessionId, onFlush, intervalMs = 5000 }: UseOfflineQueueOptions): UseOfflineQueueResult {
  const [ready, setReady] = useState(false)
  const [queuedByLineId, setQueuedByLineId] = useState<Map<string, QueuedLineMutation>>(new Map())

  // `queueRef` is the source of truth read by enqueue/flush logic (avoids
  // stale closures in the interval/online-event callbacks); `queuedByLineId`
  // state is just a render-friendly mirror of it, synced via `syncState`.
  const queueRef = useRef<Map<string, QueuedLineMutation>>(new Map())
  const dbRef = useRef<IDBDatabase | null>(null)
  const onFlushRef = useRef(onFlush)
  const flushingRef = useRef(false)

  useEffect(() => {
    onFlushRef.current = onFlush
  }, [onFlush])

  const syncState = useCallback(() => {
    setQueuedByLineId(new Map(queueRef.current))
  }, [])

  // Load any pending queue for this session on mount / whenever sessionId
  // changes (this is what makes a page reload/crash mid-dead-zone safe —
  // whatever was queued before is still here). If IndexedDB itself is
  // unavailable (private mode / very old browser), degrade to "no offline
  // queue" rather than throwing; the caller's own fetch try/catch still
  // surfaces a normal save error.
  //
  // Note: this file's own eslint run surfaces `react-hooks/set-state-in-effect`
  // on the synchronous setReady(false)/syncState() reset below — the same
  // rule already fires on pre-existing, untouched code elsewhere in this repo
  // (useProductSearch.ts, AddEquipmentModal.tsx, CreateTicketModal.tsx), so
  // this isn't a new category of lint debt, just the same repo-wide gap.
  // Reworking it into the render-time "adjust state" pattern instead runs
  // into `react-hooks/refs` (no ref reads/writes during render), so the
  // straightforward effect is the least-bad option available without a
  // repo-wide lint-rule remediation pass, which is out of this task's scope.
  useEffect(() => {
    let cancelled = false
    setReady(false)
    queueRef.current = new Map()
    syncState()
    openDb()
      .then(async (db) => {
        if (cancelled) return
        dbRef.current = db
        const rows = await getMutationsForSession(db, sessionId)
        if (cancelled) return
        queueRef.current = new Map(rows.map((r) => [r.lineId, { lineId: r.lineId, patch: r.patch, updatedAt: r.updatedAt }]))
        syncState()
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, syncState])

  const enqueue = useCallback(
    (lineId: string, patch: QueuedLinePatch) => {
      const mutation: QueuedLineMutation = { lineId, patch, updatedAt: Date.now() }
      queueRef.current.set(lineId, mutation)
      syncState()
      // Best-effort persist — if it fails, the in-memory queue still drives
      // this page session's flush; it just won't survive a reload.
      ;(async () => {
        try {
          const db = dbRef.current ?? (await openDb())
          dbRef.current = db
          await putMutation(db, sessionId, mutation)
        } catch {
          // ignore — see comment above
        }
      })()
    },
    [sessionId, syncState]
  )

  const flushOne = useCallback(
    async (mutation: QueuedLineMutation) => {
      try {
        await onFlushRef.current(mutation)
        // Only clear if this is still the current queued edit for the line —
        // if a newer edit replaced it while the PATCH was in flight
        // (latest-wins), that newer edit must survive for the next flush.
        const current = queueRef.current.get(mutation.lineId)
        if (current && current.updatedAt === mutation.updatedAt) {
          queueRef.current.delete(mutation.lineId)
          syncState()
          try {
            const db = dbRef.current
            if (db) await deleteMutation(db, sessionId, mutation.lineId)
          } catch {
            // ignore — worst case a flushed entry lingers in IndexedDB and is
            // re-attempted harmlessly (PATCH is idempotent per line).
          }
        }
      } catch {
        // Leave queued — network still down, or the request itself failed.
        // Retried on the next interval tick / online event.
      }
    },
    [sessionId, syncState]
  )

  const flushNow = useCallback(() => {
    if (flushingRef.current) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const entries = Array.from(queueRef.current.values())
    if (entries.length === 0) return
    flushingRef.current = true
    ;(async () => {
      for (const mutation of entries) {
        await flushOne(mutation)
      }
      flushingRef.current = false
    })()
  }, [flushOne])

  // Auto-flush: once ready (covers "already online with entries queued from
  // before a reload"), on every `online` event, and on a short interval while
  // online (covers "came back online but no `online` event fired", e.g. a
  // flaky connection that never fully registers as offline).
  useEffect(() => {
    if (!ready) return
    flushNow()
    function handleOnline() {
      flushNow()
    }
    window.addEventListener('online', handleOnline)
    const interval = setInterval(flushNow, intervalMs)
    return () => {
      window.removeEventListener('online', handleOnline)
      clearInterval(interval)
    }
  }, [ready, flushNow, intervalMs])

  return {
    ready,
    queuedByLineId,
    pendingCount: queuedByLineId.size,
    enqueue,
    flushNow,
  }
}
