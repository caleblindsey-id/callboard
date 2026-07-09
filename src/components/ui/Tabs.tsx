export interface TabItem {
  key: string
  label: string
  /** Optional count badge rendered after the label. Omit to render no badge for that tab. */
  count?: number
}

export interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
  ariaLabel?: string
  className?: string
}

/**
 * The one pill tab bar (standard-draft dimension 7), extracted from the 5 copy-pasted
 * `rounded-lg bg-gray-100 p-1` implementations (supply-requests, supply-requests/report,
 * pickup-queue, estimate-queue, service/report). Use for a genuine set of peer views over
 * one dataset (pipeline stages, status buckets) — scrolls horizontally on overflow instead
 * of wrapping, so it never breaks a page's rhythm at narrow widths. For a plain 2-3 option
 * toggle (no scrolling, no counts) use `SegmentedControl` instead, not this component.
 *
 * Pipeline-stage tabs render ABOVE `FilterBar`, not inside it (red-team amendment to
 * standard-draft dimension 6) — `FilterBar`'s own `segmented` prop is reserved for genuine
 * 2-3 option toggles that are filters, not for a page's primary tab navigation.
 */
export default function Tabs({ tabs, active, onChange, ariaLabel, className = '' }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{ scrollbarWidth: 'thin' }}
      className={`flex gap-1 overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-800 p-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600 ${className}`.trim()}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`shrink-0 inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
              isActive
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                  isActive
                    ? 'bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
