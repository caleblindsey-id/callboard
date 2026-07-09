import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Canonical copy for a list's empty body per standard-draft dimension 10:
 * "No {plural}s yet." when nothing has been created, "No {plural}s match
 * your filters." when a filter/search is narrowing an otherwise-populated
 * list. Pass the plain plural noun ("service tickets", "customers") — the
 * period is included.
 */
export function emptyCopy(entity: string, filtered: boolean): string {
  return filtered ? `No ${entity} match your filters.` : `No ${entity} yet.`
}

export interface EmptyStateProps {
  icon: LucideIcon
  message: string
  action?: ReactNode
  className?: string
}

/**
 * The one empty-list body for CallBoard: a dashed-border box, an icon, a
 * one-line message, and an optional action (usually a `Button`). Use this in
 * place of a bare "No X found" string or a full empty card — it replaces the
 * list body in-place, it does not wrap the whole section. Build the message
 * with `emptyCopy()` unless the page has a genuinely different one-off need.
 */
export default function EmptyState({ icon: Icon, message, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center ${className}`.trim()}
    >
      <Icon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
      <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      {action}
    </div>
  )
}
