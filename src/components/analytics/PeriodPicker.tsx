'use client'

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  stepPeriod,
  isCurrentPeriod,
  monthOptions,
  monthValueOf,
  monthLabel,
  type AnalyticsPeriodType,
} from '@/lib/analytics-period'

export interface PeriodPickerProps {
  periodType: AnalyticsPeriodType
  /** `YYYY-MM-DD` anchor — any day inside the selected period. */
  date: string
  onChange: (date: string) => void
  /** Greys the control out while a fetch is in flight. */
  disabled?: boolean
  className?: string
}

/**
 * Moves the analytics pages through historical periods.
 *
 * The arrows step by the **active period type** — a month in monthly mode, a
 * week in weekly mode — which is why this is arrows-plus-dropdown rather than a
 * plain `<input type="month">`: the pages keep their Weekly/Monthly toggle, and
 * a month-only control would strand weekly mode.
 *
 * The dropdown stays visible in weekly mode on purpose. It jumps to the 1st of
 * the chosen month (so weekly lands on the week containing the 1st) and the
 * arrows walk from there; without it, reaching last spring a week at a time is
 * ~26 clicks.
 *
 * Forward paging stops at the current period — future ranges only render zeros.
 */
export default function PeriodPicker({
  periodType,
  date,
  onChange,
  disabled = false,
  className = '',
}: PeriodPickerProps) {
  const atCurrent = isCurrentPeriod(date, periodType)
  const selectedMonth = monthValueOf(date)

  const options = useMemo(() => {
    const opts = monthOptions()
    // A deep-linked or bookmarked URL can point outside the rolling window; keep
    // its month in the list so the select doesn't render blank.
    if (!opts.some((o) => o.value === selectedMonth)) {
      return [...opts, { value: selectedMonth, label: monthLabel(selectedMonth) }].sort((a, b) =>
        b.value.localeCompare(a.value)
      )
    }
    return opts
  }, [selectedMonth])

  const arrowClass =
    'flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white dark:disabled:hover:bg-gray-800 lg:min-h-0 lg:py-1.5'

  return (
    <div className={`flex items-center gap-1 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => onChange(stepPeriod(date, periodType, -1))}
        disabled={disabled}
        aria-label={periodType === 'weekly' ? 'Previous week' : 'Previous month'}
        className={arrowClass}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <select
        value={selectedMonth}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Select month"
        className="min-h-[44px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-0"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => onChange(stepPeriod(date, periodType, 1))}
        disabled={disabled || atCurrent}
        aria-label={periodType === 'weekly' ? 'Next week' : 'Next month'}
        className={arrowClass}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
