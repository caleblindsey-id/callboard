'use client'

import { useEffect } from 'react'
import ErrorScreen from '@/components/ErrorScreen'

// Route-specific override of src/app/error.tsx. Previously a bare one-line
// fallback with no "Back to dashboard" affordance; now renders the same
// shared ErrorScreen so the two boundaries stop diverging.
export default function TicketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('tickets route error boundary:', error)
  }, [error])

  return <ErrorScreen reset={reset} />
}
