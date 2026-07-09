'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Persists form state to localStorage with debounced writes.
 *
 * - On mount: reads `localStorage[key]`. If a draft exists and `isMeaningful(state)`
 *   returns true for the persisted state, calls `onRestore` and reports `restoredAt`
 *   so the caller can render a "Draft restored — last edited X min ago" toast.
 * - On every change to `state`: schedules a 300ms debounced write of
 *   `{ state, lastEditedAt }` to localStorage, but only after the user has
 *   actually edited (the very first effect run is skipped so opening a blank
 *   modal does not write a phantom empty draft).
 * - `clearDraft()` and `discardDraft()` both cancel any pending debounced write
 *   AND remove the key — critical so a queued setTimeout doesn't resurrect the
 *   draft 300ms after a successful submit.
 *
 * Uses a ref alongside `state` to keep the debounced callback's view of state
 * current (avoids the React-stale-closure trap when the debounce timer fires).
 *
 * The payload shape is `{ state: T, lastEditedAt: number }` so `lastEditedAt`
 * doesn't bleed into your form state.
 */
export interface UseFormDraftOptions<T> {
  /** localStorage key — pick a distinct one per form. */
  key: string
  /** Current form state — hook reads this for the debounced write. */
  state: T
  /**
   * Called once on mount if a meaningful draft is found. Receives the restored
   * state and the wall-clock ms the draft was last edited (`lastEditedAt`), so
   * a caller that also has a server-side "last saved" timestamp can gate the
   * restore itself (e.g. skip if the draft is older than the server value —
   * the hook always fires this callback when a meaningful draft exists, it
   * does not know about your server timestamp).
   */
  onRestore: (draft: T, lastEditedAt: number) => void
  /**
   * Returns true if `state` is non-trivial enough to bother persisting/restoring.
   * Defaults to "always true". Use this to skip toast-on-empty.
   */
  isMeaningful?: (state: T) => boolean
  /** Disable the hook (no reads, no writes). Defaults to true. */
  enabled?: boolean
}

export interface UseFormDraftResult {
  /** Wall-clock ms when the restored draft was last edited; null if no restore. */
  restoredAt: number | null
  /** Dismiss the "Draft restored" toast without touching the persisted draft. */
  dismissRestoredToast: () => void
  /** Cancel pending writes + remove key. Call on successful submit. */
  clearDraft: () => void
  /**
   * Cancel pending writes + remove key + null out the toast. Returned for
   * convenience when the parent wires up a "Discard draft" button — the
   * caller is still responsible for resetting form state.
   */
  discardDraft: () => void
  /**
   * Wall-clock ms of the most recent successful debounced write to
   * localStorage; null until the first write. Bumps on every write (not just
   * the first), so a caller can drive a transient "Saved on this device"
   * indicator the same way `saveSuccess` drives a server-save indicator.
   */
  lastPersistedAt: number | null
}

interface PersistedDraft<T> {
  state: T
  lastEditedAt: number
}

const DEBOUNCE_MS = 300

export function useFormDraft<T>({
  key,
  state,
  onRestore,
  isMeaningful,
  enabled = true,
}: UseFormDraftOptions<T>): UseFormDraftResult {
  const [restoredAt, setRestoredAt] = useState<number | null>(null)
  const [lastPersistedAt, setLastPersistedAt] = useState<number | null>(null)
  const stateRef = useRef(state)
  const keyRef = useRef(key)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRestoreRef = useRef(onRestore)
  const isMeaningfulRef = useRef(isMeaningful)
  const hasMountedRef = useRef(false)
  const hasUserEditedRef = useRef(false)

  // Keep refs current so the debounce callback uses fresh values
  // without re-binding (sidesteps the stale-closure trap on `useEffect([])`).
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    keyRef.current = key
  }, [key])

  useEffect(() => {
    onRestoreRef.current = onRestore
  }, [onRestore])

  useEffect(() => {
    isMeaningfulRef.current = isMeaningful
  }, [isMeaningful])

  // Enable-edge: try to restore once each time the hook goes from disabled to
  // enabled. For modals that conditionally render via `open`, this means the
  // restore + toast fire on each modal open. For always-mounted pages, it's
  // the initial mount. We reset `hasUserEditedRef` here so we don't immediately
  // write a duplicate "edit" event from the restored state.
  //
  // We do NOT try to flush a pending debounced write on the enabled→disabled
  // edge because React fires the write effect's cleanup *before* this effect
  // runs, which has already cleared `debounceRef`. The cost is at most ~300ms
  // of typing dropped on close — acceptable; the user can reopen and continue.
  useEffect(() => {
    if (!enabled) {
      hasMountedRef.current = false
      return
    }
    if (hasMountedRef.current) return
    hasMountedRef.current = true
    hasUserEditedRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedDraft<T> | null
      if (!parsed || typeof parsed !== 'object') return
      if (typeof parsed.lastEditedAt !== 'number') return
      const check = isMeaningfulRef.current
      if (check && !check(parsed.state)) return
      onRestoreRef.current(parsed.state, parsed.lastEditedAt)
      setRestoredAt(parsed.lastEditedAt)
    } catch {
      // Corrupt JSON or other access error — just skip.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Debounced write. Only fires after the user has actually changed state once.
  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    // Skip the very first run so opening a blank form doesn't immediately
    // persist an empty draft (which would re-fire the toast on next open).
    if (!hasUserEditedRef.current) {
      hasUserEditedRef.current = true
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      try {
        const check = isMeaningfulRef.current
        const current = stateRef.current
        // If the user has emptied the form back to nothing, drop the draft
        // rather than persist a useless empty record.
        if (check && !check(current)) {
          window.localStorage.removeItem(keyRef.current)
          return
        }
        const now = Date.now()
        const payload: PersistedDraft<T> = {
          state: current,
          lastEditedAt: now,
        }
        window.localStorage.setItem(keyRef.current, JSON.stringify(payload))
        setLastPersistedAt(now)
      } catch {
        // Quota exceeded, private-mode disabled storage, etc.
      }
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [state, enabled])

  const clearDraft = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setLastPersistedAt(null)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(keyRef.current)
    } catch {
      // ignore
    }
  }, [])

  const dismissRestoredToast = useCallback(() => {
    setRestoredAt(null)
  }, [])

  const discardDraft = useCallback(() => {
    clearDraft()
    setRestoredAt(null)
  }, [clearDraft])

  return { restoredAt, dismissRestoredToast, clearDraft, discardDraft, lastPersistedAt }
}

/**
 * Render-helper: turns a `lastEditedAt` epoch-ms into a compact relative label
 * like "just now", "5 min ago", "2 h ago", "yesterday".
 */
export function formatDraftAge(lastEditedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - lastEditedAt)
  const sec = Math.floor(diffMs / 1000)
  if (sec < 30) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days} d ago`
}
