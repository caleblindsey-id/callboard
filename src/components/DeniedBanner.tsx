'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

// Dismissible banner surfaced on the dashboard when the proxy redirects a
// role-restricted route back to '/' with ?error=denied (src/proxy.ts).
// Dismissal is local-only state — no persistence needed since the query
// param is gone on the next navigation anyway.
export default function DeniedBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5">
      <p className="flex-1 text-sm text-amber-800 dark:text-amber-300">
        You don&apos;t have access to that page.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
