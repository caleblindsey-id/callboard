'use client'

import ErrorScreen from '@/components/ErrorScreen'
import { APP_NAME } from '@/lib/branding'

// Root-level error boundary — the ONLY boundary that catches an error thrown
// by the root layout itself (e.g. before layout.tsx guarded its
// getCurrentUser() call). Next.js requires this file to render its own
// <html>/<body> since it replaces the root layout entirely, so there is no
// Sidebar/LayoutShell chrome available at this level.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-sm px-4">
          <p className="text-center text-sm font-semibold text-gray-400 dark:text-gray-500 mb-4 tracking-tight">
            {APP_NAME}
          </p>
          <ErrorScreen reset={reset} />
        </div>
      </body>
    </html>
  )
}
