'use client'

import { useEffect, useState } from 'react'

interface CancelPartDialogProps {
  open: boolean
  description: string
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}

const MAX_REASON_LEN = 1000

export default function CancelPartDialog({ open, description, onCancel, onConfirm }: CancelPartDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset form when the dialog transitions from closed to open.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
      setError(null)
      setSubmitting(false)
    }
  }

  // Escape-to-dismiss — accessibility (WCAG 2.1.2).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, submitting, onCancel])

  async function handleConfirm() {
    if (!reason.trim()) {
      setError('Please enter a reason.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-part-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel()
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="cancel-part-title" className="text-base font-semibold text-gray-900 dark:text-white">Cancel part request</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{description}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label htmlFor="cancel-reason" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            Reason (visible on the ticket)
          </label>
          <textarea
            id="cancel-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
            rows={3}
            maxLength={MAX_REASON_LEN}
            placeholder="e.g. Warranty covered direct by vendor, wrong part, customer withdrew..."
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Keep request
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !reason.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Cancelling…' : 'Cancel request'}
          </button>
        </div>
      </div>
    </div>
  )
}
