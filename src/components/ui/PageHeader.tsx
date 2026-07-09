import type { ReactNode } from 'react'
import BackButton from '@/components/BackButton'

export interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Renders the shared `BackButton` to the left of the title (this value becomes its
   * `fallbackHref`) — for detail pages navigating back to their parent list. List pages
   * omit this; the sidebar is their nav (standard-draft dimension 16). */
  backHref?: string
  /** Right-aligned slot — the page's single primary action (e.g. "New Service Ticket")
   * plus any secondary link/buttons. Wraps below the title on small screens instead of
   * squeezing the header. On detail pages this is also where a status badge can sit next
   * to the primary action (standard-draft dimension 1); compose it into this slot. */
  actions?: ReactNode
  className?: string
}

/**
 * The one page header for CallBoard list and detail pages (standard-draft dimension 1):
 * left-aligned `h1` + optional gray subtitle directly below, optional `BackButton` to the
 * left of the title, and an `actions` slot pinned top-right on the same baseline. Renders
 * INSIDE a page's existing `p-6 space-y-6` shell (see the CallBoard Page Shell standard) —
 * it is the header block, not a replacement for that outer wrapper, and it does not itself
 * carry any responsive padding/type-scale changes (only the actions row reflows on mobile).
 */
export default function PageHeader({ title, subtitle, backHref, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`.trim()}>
      <div className="flex items-start gap-2 min-w-0">
        {backHref && <BackButton fallbackHref={backHref} />}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  )
}
