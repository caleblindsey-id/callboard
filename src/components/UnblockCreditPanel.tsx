'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

interface UnblockCreditPanelProps {
  reviewId: string
  blockReason?: string | null
  decidedByName?: string | null
  onUnblocked?: () => void
}

// Manager-only inline panel to unblock an AR-blocked order with the shared
// release passcode. Used identically on PM and service ticket detail pages.
export default function UnblockCreditPanel({
  reviewId,
  blockReason,
  decidedByName,
  onUnblocked,
}: UnblockCreditPanelProps) {
  const router = useRouter()
  const [passcode, setPasscode] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnblock() {
    if (!passcode) {
      setError('Enter the release passcode.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/credit-reviews/${reviewId}/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Failed to unblock.')
        setPasscode('')
        return
      }
      if (onUnblocked) onUnblocked()
      router.refresh()
    } catch {
      setError('Could not unblock. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
      <div className="flex items-start gap-2 mb-3">
        <Lock className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
        <div className="text-sm text-red-800 dark:text-red-300">
          <p className="font-semibold">AR blocked this order.</p>
          {blockReason && <p className="mt-0.5 text-xs">Reason: {blockReason}</p>}
          {decidedByName && <p className="mt-0.5 text-xs text-red-700/80 dark:text-red-400/80">Blocked by {decidedByName}</p>}
        </div>
      </div>
      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        Manager override — enter release passcode
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          autoComplete="off"
          value={passcode}
          onChange={(e) => { setPasscode(e.target.value); setError(null) }}
          placeholder="Release passcode"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
        />
        <button
          onClick={handleUnblock}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {submitting ? 'Unblocking…' : 'Unblock & proceed'}
        </button>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="mt-2 w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
      />
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
    </div>
  )
}
