'use client'

import { useEffect } from 'react'
import ErrorScreen from '@/components/ErrorScreen'

// App-level error boundary — before this only /tickets had one, so a thrown
// server-component error anywhere else surfaced Next's default screen with no
// recovery path. Renders the shared ErrorScreen so this and
// src/app/tickets/error.tsx stay in sync instead of diverging.
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

  return <ErrorScreen reset={reset} />
}
