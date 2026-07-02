'use client'

import { useEffect } from 'react'
import Link from 'next/link'

// App-level error boundary — before this only /tickets had one, so a thrown
// server-component error anywhere else surfaced Next's default screen with no
// recovery path. Mirrors src/app/tickets/error.tsx with a retry affordance.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('route error boundary:', error)
  }, [error])

  return (
    <div className="p-6 max-w-lg">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          Something went wrong
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4" role="alert">
          This page failed to load. It is usually temporary — try again, and if it keeps
          happening, let the office know what you were doing.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-sm text-slate-700 dark:text-slate-300 underline"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
