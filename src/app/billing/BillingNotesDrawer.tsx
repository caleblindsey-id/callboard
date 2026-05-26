'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import CustomerNotes from '@/components/CustomerNotes'

interface BillingNotesDrawerProps {
  customerId: number | null
  customerName: string | null
  onClose: () => void
}

/**
 * Right-side slide-over that shows a customer's billing/contact notes from the
 * billing list. The same customer can appear on multiple ticket rows; every
 * row opens this shared log keyed to customer_id.
 */
export default function BillingNotesDrawer({
  customerId,
  customerName,
  onClose,
}: BillingNotesDrawerProps) {
  const open = customerId != null

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-800 shadow-xl flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
              Billing Notes
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {customerName ?? '—'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <CustomerNotes key={customerId} customerId={customerId} />
        </div>
      </div>
    </div>
  )
}
