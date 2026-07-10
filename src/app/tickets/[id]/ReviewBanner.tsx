'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Flag } from 'lucide-react'
import Modal from '@/components/ui/Modal'

interface Props {
  ticketId: string
  reviewReason: string | null
}

export default function ReviewBanner({ ticketId, reviewReason }: Props) {
  const router = useRouter()
  const [confirmingSkip, setConfirmingSkip] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: 'approve' | 'skip') {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Failed to ${action} review`)
        return
      }
      setConfirmingSkip(false)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-300 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Flag className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
              Flagged for Review
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">
              {reviewReason ?? 'A prior PM for this equipment is still open.'}
              {' '}Approve to keep this ticket, or skip if the prior PM will absorb the work.
            </p>
            {error && (
              <p className="text-sm text-red-700 dark:text-red-400 mt-2">{error}</p>
            )}
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <button
                onClick={() => submit('approve')}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
              >
                {submitting ? 'Working…' : 'Approve & Keep'}
              </button>
              <button
                onClick={() => setConfirmingSkip(true)}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-gray-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px] sm:min-h-0"
              >
                Skip This PM
              </button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={confirmingSkip}
        onClose={() => setConfirmingSkip(false)}
        dismissible={!submitting}
        size="md"
        ariaLabelledBy="skip-pm-title"
      >
          <div className="p-5 border-b border-gray-200 dark:border-gray-700">
            <h3 id="skip-pm-title" className="text-base font-semibold text-gray-900 dark:text-white">
              Skip this PM?
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              This ticket will be marked as skipped. The prior open PM remains untouched.
            </p>
          </div>
          <div className="p-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              onClick={() => setConfirmingSkip(false)}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-gray-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              Cancel
            </button>
            <button
              onClick={() => submit('skip')}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
            >
              {submitting ? 'Skipping…' : 'Skip PM'}
            </button>
          </div>
      </Modal>
    </>
  )
}
