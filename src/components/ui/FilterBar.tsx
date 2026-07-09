'use client'

import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import SegmentedControl, { type SegmentedOption } from './SegmentedControl'

export interface FilterBarSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export interface FilterBarSegmentedProps {
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}

export interface FilterBarProps {
  /** Rendered first, always visible (even collapsed on mobile) — the one control worth
   * reaching without an extra tap. */
  search?: FilterBarSearchProps
  /** A genuine 2-3 option toggle that is a filter (not a pipeline-stage tab bar — those
   * render as `Tabs` above `FilterBar`, see the component's own doc block). */
  segmented?: FilterBarSegmentedProps
  /** Count of active filters among `segmented` and the caller's own `children` controls
   * (selects, checkboxes) — shown on the mobile "Filters" disclosure badge. `FilterBar`
   * can't introspect opaque `children`, so the caller reports how many are set away from
   * their default/"All" value. Search is not counted here — it has its own always-visible
   * affordance. */
  activeCount?: number
  /** Arbitrary filter controls (selects, checkboxes, an Apply button) — rendered after
   * `search`/`segmented`, in a flex-wrap row on desktop, and behind the mobile disclosure. */
  children?: ReactNode
  className?: string
}

/**
 * The one filter row (standard-draft dimension 6): a bordered card directly below
 * `PageHeader`, search first, then arbitrary filter controls. Below `lg` the controls
 * (everything but search) collapse behind a "Filters" disclosure button with an
 * active-filter count badge, so a page with several selects doesn't push its list out of
 * the first viewport on a phone (the ~1450px-before-content mobile complaint on the PM
 * board). At `lg` and up the disclosure is hidden and every control renders inline.
 *
 * Deliberately does NOT URL-sync filter state itself — pair with `useUrlFilters`
 * (src/lib/hooks/useUrlFilters.ts) in the caller for that; `FilterBar` only owns layout.
 */
export default function FilterBar({ search, segmented, activeCount = 0, children, className = '' }: FilterBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const disclosureId = useId()
  const hasCollapsibleControls = Boolean(segmented) || Boolean(children)

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
        {search && (
          <div className="w-full lg:w-64">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                placeholder={search.placeholder}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 pl-8 pr-8 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              {search.value && (
                <button
                  type="button"
                  onClick={() => search.onChange('')}
                  aria-label="Clear search"
                  className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {hasCollapsibleControls && (
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls={disclosureId}
            className="lg:hidden inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeCount > 0 && (
              <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-800 dark:bg-slate-600 px-1.5 text-xs font-semibold text-white">
                {activeCount}
              </span>
            )}
          </button>
        )}

        {/* `lg:contents` drops this wrapper from the box model at `lg`+ so its children
            flow directly into the flex-wrap row above, matching the pre-existing desktop
            layout exactly. Below `lg` the wrapper is a real flex-col block, shown only
            while `mobileOpen`. */}
        {hasCollapsibleControls && (
          <div id={disclosureId} className={`${mobileOpen ? 'flex flex-col gap-3' : 'hidden'} lg:contents`}>
            {segmented && (
              <div className="w-full lg:w-auto">
                <SegmentedControl
                  options={segmented.options}
                  value={segmented.value}
                  onChange={segmented.onChange}
                  ariaLabel={segmented.ariaLabel}
                />
              </div>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
