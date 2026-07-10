import type { ReactNode } from 'react'
import InlineError from '@/components/ui/InlineError'
import SkipRequestForm, { SkipRequestPayload } from '../SkipRequestForm'

export interface UnassignedAssignedPanelProps {
  error: string | null
  loading: boolean
  onStart: () => void
  isTech: boolean
  skipRequestOpen: boolean
  onOpenSkipRequest: () => void
  onCancelSkipRequest: () => void
  skipDefaultMonth: number
  skipDefaultYear: number
  onSubmitSkipRequest: (payload: SkipRequestPayload) => void
  superAdminOverride: ReactNode
  deleteButton: ReactNode
  confirmActionDialog: ReactNode
}

/**
 * Actions panel for 'unassigned' / 'assigned' PM tickets: Start Work, plus
 * a tech's Request Skip. Mechanical extraction from TicketActions.tsx (round
 * 12 stage A); no logic changed, only moved.
 */
export default function UnassignedAssignedPanel({
  error,
  loading,
  onStart,
  isTech,
  skipRequestOpen,
  onOpenSkipRequest,
  onCancelSkipRequest,
  skipDefaultMonth,
  skipDefaultYear,
  onSubmitSkipRequest,
  superAdminOverride,
  deleteButton,
  confirmActionDialog,
}: UnassignedAssignedPanelProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        Actions
      </h2>
      {error && <InlineError message={error} className="mb-3" />}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onStart}
          disabled={loading}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Starting...' : 'Start Work'}
        </button>
        {isTech && (
          <button
            type="button"
            onClick={onOpenSkipRequest}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Request Skip
          </button>
        )}
      </div>
      {skipRequestOpen && isTech && (
        <SkipRequestForm
          defaultMonth={skipDefaultMonth}
          defaultYear={skipDefaultYear}
          loading={loading}
          onSubmit={onSubmitSkipRequest}
          onCancel={onCancelSkipRequest}
        />
      )}
      {superAdminOverride}
      {deleteButton}
      {confirmActionDialog}
    </div>
  )
}
