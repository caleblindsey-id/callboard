'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { normalizeShippingCharge } from '@/lib/shipping'

interface FreightPromptDialogProps {
  open: boolean
  /** Part description, so the buyer can see what they just ordered. */
  description: string
  /** Vendor the PO went to — the freight is theirs. */
  vendor: string | null
  workOrderNumber: number | null
  onSkip: () => void
  onConfirm: (amount: number) => Promise<void>
}

/**
 * Asked once per ticket, immediately after a part is marked ordered, when no
 * freight has been recorded yet (feedback #80).
 *
 * Why a prompt and not a required field: across every service and PM ticket in
 * the system, zero had ever carried a freight line — the branch absorbed 100%
 * of inbound shipping. A field alone would not have changed that, because
 * nothing would bring anyone to it. This is the one moment someone is looking
 * at the vendor's freight quote.
 *
 * Why it is skippable: plenty of orders genuinely carry no freight (stock
 * pulls, warranty replacements, vendors who ship free over a threshold), and a
 * hard gate on those would stall real ordering work and train people to type a
 * 0 to get past it — which is worse than no answer at all, because a stored 0
 * looks like a deliberate "freight was free".
 */
export default function FreightPromptDialog({
  open,
  description,
  vendor,
  workOrderNumber,
  onSkip,
  onConfirm,
}: FreightPromptDialogProps) {
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset on each open — same controlled-reset pattern as TriageOrderDialog,
  // which avoids a setState-in-effect the lint rule would (correctly) reject.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setAmount('')
      setError(null)
      setSubmitting(false)
    }
  }

  async function handleConfirm() {
    const parsed = normalizeShippingCharge(amount)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.value === null) {
      setError('Enter a freight amount, or choose “No freight on this order”.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(parsed.value)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save shipping charge')
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onSkip} dismissible={!submitting} size="md" ariaLabelledBy="freight-prompt-title">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 id="freight-prompt-title" className="text-base font-semibold text-gray-900 dark:text-white">
          Freight on this order?
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{description}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {vendor ? <>Ordered from {vendor}</> : null}
          {vendor && workOrderNumber ? ' · ' : null}
          {workOrderNumber ? <>WO#{workOrderNumber}</> : null}
        </p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <label htmlFor="freight-amount" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Shipping to bill the customer
        </label>
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400 text-sm">$</span>
          <input
            id="freight-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
            autoFocus
            placeholder="0.00"
            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Goes on the work order as its own Shipping line. Covers the whole
          order, so you only get asked once per ticket — add the other parts&rsquo;
          freight here too if they ship together.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
      </div>
      <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          No freight on this order
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting || !amount.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving…' : 'Save shipping'}
        </button>
      </div>
    </Modal>
  )
}
