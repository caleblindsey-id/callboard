'use client'

import Link from 'next/link'
import { CheckCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'

interface CompletionSuccessDialogProps {
  open: boolean
  ticketsHref: string
  ticketsLabel: string
  onViewWorkOrder: () => void
}

// A thin preset of Modal (see src/components/ui/Modal.tsx), same pattern as
// ConfirmDialog: supplies its own icon+title+message+links as children
// rather than using Modal's title/footer slots, so the rendered markup stays
// byte-identical to the original standalone implementation this was
// generalized from. `onViewWorkOrder` doubles as the dismiss handler
// (backdrop click, Escape, and the "View work order" link all resolve the
// same way the original did).
export default function CompletionSuccessDialog({
  open,
  ticketsHref,
  ticketsLabel,
  onViewWorkOrder,
}: CompletionSuccessDialogProps) {
  return (
    <Modal open={open} onClose={onViewWorkOrder} ariaLabelledBy="completion-success-title" className="p-6 text-center">
      <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
      <h3 id="completion-success-title" className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">Ticket completed</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Where would you like to go next?</p>

      <div className="mt-6 flex flex-col gap-3">
        <Link
          href={ticketsHref}
          className="flex items-center justify-center px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors min-h-[44px]"
        >
          {ticketsLabel}
        </Link>
        <Link
          href="/"
          className="flex items-center justify-center px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors min-h-[44px]"
        >
          Go to Dashboard
        </Link>
      </div>

      <button
        type="button"
        onClick={onViewWorkOrder}
        className="mt-4 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        View work order →
      </button>
    </Modal>
  )
}
