'use client'

import { X } from 'lucide-react'
import { formatDraftAge } from '@/lib/hooks/useFormDraft'

interface DraftRestoredToastProps {
  /** Epoch-ms when the restored draft was last edited. */
  lastEditedAt: number
  /** Called when the user dismisses the toast (does NOT discard the draft). */
  onDismiss: () => void
  /** Optional extra note, e.g. "Photos aren't saved in drafts." */
  note?: string
}

/**
 * Small inline indicator shown above a form after a localStorage draft is
 * restored. Dismiss removes the toast but leaves the draft intact (so closing
 * + reopening the modal still shows the restored data).
 */
export default function DraftRestoredToast({
  lastEditedAt,
  onDismiss,
  note,
}: DraftRestoredToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start justify-between gap-3 rounded-md border border-amber-200 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2"
    >
      <div className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
        <span className="font-medium">Draft restored</span>
        <span className="text-amber-700 dark:text-amber-300">
          {' '}— last edited {formatDraftAge(lastEditedAt)}.
        </span>
        {note && (
          <span className="block text-amber-700 dark:text-amber-300 mt-0.5">{note}</span>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss draft restored notice"
        className="shrink-0 -mt-0.5 -mr-1 p-1 text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 rounded"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
