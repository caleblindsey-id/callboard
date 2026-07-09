'use client'

import { AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/Modal'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

// Shared confirm dialog replacing window.confirm() calls app-wide. A thin
// preset of Modal (see src/components/ui/Modal.tsx) for the yes/no case: it
// supplies its own icon+title+message+buttons as children rather than using
// Modal's title/footer slots, so the rendered markup stays byte-identical to
// the original standalone implementation this was generalized from. Modal
// contributes the shell (focus-on-open, Tab trap, Escape, scroll lock,
// backdrop). While loading, dismissal is disabled so an in-flight action
// can't be double-triggered or orphaned.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDialogProps) {
  const confirmClasses =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600'

  return (
    <Modal open={open} onClose={onCancel} dismissible={!loading} ariaLabelledBy="confirm-dialog-title" className="p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`h-5 w-5 mt-0.5 shrink-0 ${confirmVariant === 'danger' ? 'text-red-500' : 'text-yellow-500'}`}
        />
        <div>
          <h3 id="confirm-dialog-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{message}</p>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-md disabled:opacity-50 ${confirmClasses}`}
        >
          {loading ? 'Processing…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
