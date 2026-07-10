import type { ReactNode } from 'react'

export interface NextStepShellProps {
  /** Small uppercase eyebrow label, e.g. "Next Step". */
  label: string
  /** Optional one-line context under the label, above the actions. */
  description?: string
  /** The actual per-status buttons/forms, owned entirely by the caller. */
  children: ReactNode
}

/**
 * Dumb chrome shared by the service and PM "next step" action bars: the
 * sticky-feeling card placement, label row, and spacing. Carries zero
 * transition/gate logic: each detail page keeps its own state machine and
 * decides what to render as `children` (round 12 red-team constraint: the
 * shell is shared, the state machines are not).
 */
export default function NextStepShell({ label, description, children }: NextStepShellProps) {
  return (
    <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-800 shadow-sm p-4 sm:p-5 space-y-3">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </p>
      {description && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
      )}
      {children}
    </div>
  )
}
