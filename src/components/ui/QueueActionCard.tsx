import type { ReactNode } from 'react'

export interface QueueActionCardProps {
  /** Primary identity content, rendered top-left (e.g. a customer-name Link). */
  title: ReactNode
  /** Secondary line(s) under the title (WO #, equipment, meta info). */
  sub?: ReactNode
  /** Status/aging pill rendered top-right, next to `actions`. */
  badge?: ReactNode
  /**
   * Compact controls rendered top-right, alongside `badge` (e.g. warranty-queue's
   * "File claim" / "Log credit" trigger). Omit and use `footer` instead when the
   * action needs full-width stacked buttons (e.g. pickup-queue's mobile actions).
   */
  actions?: ReactNode
  /** Body content between the header row and `footer`. */
  children?: ReactNode
  /** Full-width action row below the body. */
  footer?: ReactNode
  /**
   * Inline expand-form area (file claim / log credit / confirm pickup, etc).
   * Rendered below `footer` with a top border, only when truthy — the caller
   * owns the open/closed state.
   */
  expanded?: ReactNode
  className?: string
}

/**
 * The one item+badge+actions+inline-expand-form shape shared by the single-entity
 * work queues (pickup-queue, warranty-queue). Round 10 extraction of a shape three
 * pages hand-built independently (queues-pickup-warranty-6) — identity line, an
 * aging/status badge, one or two action controls, and an optional inline form that
 * opens below the card. Callers keep their own data-fetch/mutation logic; this
 * component only owns the shell.
 */
export default function QueueActionCard({
  title,
  sub,
  badge,
  actions,
  children,
  footer,
  expanded,
  className = '',
}: QueueActionCardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ${className}`.trim()}
    >
      <div className="p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 dark:text-white">{title}</div>
            {sub}
          </div>
          {(badge || actions) && (
            <div className="flex items-center gap-2 shrink-0">
              {badge}
              {actions}
            </div>
          )}
        </div>
        {children}
        {footer}
      </div>
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-3">{expanded}</div>
      )}
    </div>
  )
}
