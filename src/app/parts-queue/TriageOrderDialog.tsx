'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'

interface TriageOrderDialogProps {
  open: boolean
  description: string
  qtyOnHand: number | null
  qtyOnPo: number | null
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}

const MAX_REASON_LEN = 1000

// Shown only when the office chooses "Order" for a part we already have on hand
// or inbound on a PO — they must justify spending on stock we hold. A part with
// no stock/PO never reaches this dialog (it orders straight through).
export default function TriageOrderDialog({
  open,
  description,
  qtyOnHand,
  qtyOnPo,
  onCancel,
  onConfirm,
}: TriageOrderDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
      setError(null)
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      setError('Please enter a justification.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to order')
      setSubmitting(false)
    }
  }

  const onHand = qtyOnHand ?? 0
  const onPo = qtyOnPo ?? 0
  const stockParts = [
    onHand > 0 ? `${onHand} on hand` : null,
    onPo > 0 ? `${onPo} on a PO` : null,
  ].filter(Boolean)

  return (
    <Modal open={open} onClose={onCancel} dismissible={!submitting} size="md" ariaLabelledBy="triage-order-title">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="triage-order-title" className="text-base font-semibold text-gray-900 dark:text-white">
            Order anyway?
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{description}</p>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-2">
            We have {stockParts.join(' and ')}. Why order instead of pulling from stock?
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label htmlFor="triage-reason" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            Justification (saved with the part)
          </label>
          <textarea
            id="triage-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
            rows={3}
            maxLength={MAX_REASON_LEN}
            placeholder="e.g. Stock is allocated to another job, need a fresh unit, on-hand is the wrong revision…"
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
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !reason.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Ordering…' : 'Order anyway'}
          </button>
        </div>
    </Modal>
  )
}
