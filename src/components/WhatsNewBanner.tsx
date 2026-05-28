'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Sparkles, X } from 'lucide-react'
import { LATEST_UPDATE } from '@/lib/whats-new'

const STORAGE_KEY = 'callboard-whatsnew-dismissed'
const DISMISS_EVENT = 'callboard-whatsnew-dismissed'

// Read the dismissed-id from localStorage via useSyncExternalStore so the
// banner is SSR-safe (server snapshot is null) without calling setState inside
// an effect. The custom event lets the same tab re-render on dismiss.
function subscribe(callback: () => void) {
  window.addEventListener(DISMISS_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(DISMISS_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export default function WhatsNewBanner() {
  const dismissedId = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(STORAGE_KEY),
    () => null
  )

  if (!LATEST_UPDATE || dismissedId === LATEST_UPDATE.id) return null

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, LATEST_UPDATE!.id)
    window.dispatchEvent(new Event(DISMISS_EVENT))
  }

  return (
    <div className="px-4 lg:px-6 pt-4">
      <div className="flex items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="flex-1 text-sm text-blue-900 dark:text-blue-200">{LATEST_UPDATE.headline}</p>
        <Link
          href={LATEST_UPDATE.href}
          onClick={dismiss}
          className="shrink-0 text-sm font-medium text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
        >
          {LATEST_UPDATE.cta}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
