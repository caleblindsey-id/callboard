'use client'

import { useCallback, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Keeps a board's filter state in the URL so the browser/gesture Back button
 * (which only restores URLs) returns the user to their filtered view instead of
 * the default board.
 *
 * Shape is deliberately "server-prop-in / router.replace-out":
 * - Initial values come from the caller (which the server `page.tsx` seeded from
 *   `searchParams`), NOT from a client `useSearchParams()` — reading search params
 *   in a client board triggers the Next 14 Suspense/CSR-bailout build error.
 * - On `set`, local state updates immediately (snappy UI) AND the URL is rewritten
 *   via `router.replace(..., { scroll: false })`. Empty values are omitted from the
 *   query so the URL stays clean.
 *
 * On Back, the board route remounts and re-seeds from the restored URL, so both the
 * data and the controls come back filtered.
 *
 * Use `{ debounce: true }` for free-text search inputs (≈350ms) so we don't push a
 * history/replace + server re-render on every keystroke. Dropdowns/tabs replace
 * immediately.
 *
 * Values are strings; an empty string means "filter cleared" (omitted from the URL).
 */
export interface UseUrlFiltersResult<T extends Record<string, string>> {
  filters: T
  set: (key: keyof T, value: string, opts?: { debounce?: boolean }) => void
}

const DEBOUNCE_MS = 350

export function useUrlFilters<T extends Record<string, string>>(
  initial: T
): UseUrlFiltersResult<T> {
  const router = useRouter()
  const pathname = usePathname()
  const [filters, setFilters] = useState<T>(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sync = useCallback(
    (next: T, debounce: boolean) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(next)) {
        if (v) params.set(k, v)
      }
      const qs = params.toString()
      const url = qs ? `${pathname}?${qs}` : pathname
      const go = () => router.replace(url, { scroll: false })

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      if (debounce) {
        debounceRef.current = setTimeout(go, DEBOUNCE_MS)
      } else {
        go()
      }
    },
    [pathname, router]
  )

  const set = useCallback(
    (key: keyof T, value: string, opts?: { debounce?: boolean }) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value }
        sync(next, opts?.debounce ?? false)
        return next
      })
    },
    [sync]
  )

  return { filters, set }
}
