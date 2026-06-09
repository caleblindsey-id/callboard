'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Back arrow for detail pages. Returns the user to exactly where they came from
 * (the filtered board + scroll position) via `router.back()` when there is in-app
 * history, instead of a hardcoded `<Link href="/board">` that always lands on the
 * bare, unfiltered board.
 *
 * If the detail page was opened directly (deep link / fresh tab — no in-app
 * history), it falls back to `fallbackHref` so Back never strands the user.
 *
 * Styling mirrors the previous `<Link>` arrow so the swap is visually invisible.
 */
export default function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter()

  function handleClick() {
    // history.length > 1 means there's a prior entry to return to (the board the
    // user filtered). On a deep link / fresh tab it's 1 → fall back to the board.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Back"
      className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 transition-colors p-3 -m-3 rounded-md"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  )
}
