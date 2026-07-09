export interface SegmentedOption {
  value: string
  label: string
}

export interface SegmentedControlProps {
  /** 2-3 options — this is a fixed-width toggle, not a scrollable tab bar. */
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
}

/**
 * Two-to-three option toggle (standard-draft dimension 7), same visual family as `Tabs`
 * (`rounded-lg bg-gray-100 p-1`, active pill white) but non-scrollable with fixed equal
 * widths — for a genuinely binary/ternary switch (Active/Inactive, Weekly/Monthly), not a
 * pipeline-stage tab bar. Use `Tabs` instead for anything that can grow past 3 options,
 * needs count badges, or is the page's primary view navigation.
 */
export default function SegmentedControl({ options, value, onChange, ariaLabel, className = '' }: SegmentedControlProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`grid gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={`min-h-[44px] whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:min-h-0 ${
              isActive
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
