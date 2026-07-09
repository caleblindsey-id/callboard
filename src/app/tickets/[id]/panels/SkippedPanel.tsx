import type { ReactNode } from 'react'

export interface SkippedPanelProps {
  isTech: boolean
  error: string | null
  loading: boolean
  onReopen: () => void
  superAdminOverride: ReactNode
  deleteButton: ReactNode
  confirmActionDialog: ReactNode
}

/**
 * Read-only panel for a skipped PM ticket, plus the manager-only Reopen
 * action. Mechanical extraction from TicketActions.tsx (round 12 stage A);
 * no logic changed, only moved.
 */
export default function SkippedPanel({
  isTech,
  error,
  loading,
  onReopen,
  superAdminOverride,
  deleteButton,
  confirmActionDialog,
}: SkippedPanelProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        PM Ticket Skipped
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">This ticket was skipped and no work was performed.</p>
      {!isTech && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={onReopen}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 dark:text-orange-400 bg-white dark:bg-gray-700 border border-orange-300 dark:border-orange-600 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Reopening...' : 'Reopen Ticket'}
          </button>
        </div>
      )}
      {superAdminOverride}
      {deleteButton}
      {confirmActionDialog}
    </div>
  )
}
