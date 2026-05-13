'use client'

import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'danger'
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

// Small accessible confirm dialog used to replace window.confirm() calls in
// the tech-leads pages. Mirrors the ARIA pattern from ConfirmMatchModal /
// LeadReviewModal — focus-trap is NOT implemented yet (deferred to a later QC
// round) so we keep the API minimal.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  const confirmClasses =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-emerald-600 hover:bg-emerald-700'

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel()
      }}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={busy ? undefined : onCancel} />
      <div className="relative bg-white dark:bg-gray-800 sm:rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full sm:max-w-md sm:mx-4 rounded-t-xl">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 id="confirm-dialog-title" className="text-base font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{message}</p>
        </div>
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-md disabled:opacity-50 ${confirmClasses}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
