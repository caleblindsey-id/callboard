'use client'

import { useState } from 'react'
import { MONTHS } from '@/lib/utils/schedule'
import { SKIP_REASONS, SkipReasonCategory, isStopReason } from '@/lib/skip-reasons'

export interface SkipRequestPayload {
  skip_reason_category: SkipReasonCategory
  skip_recommended_month: number | null
  skip_recommended_year: number | null
  skip_equipment_on_site: boolean | null
  skip_reason: string
}

interface SkipRequestFormProps {
  // Calculated next-cycle month/year — seeds the recommendation so a sensible
  // value always flows; the tech adjusts it to the customer's request.
  defaultMonth: number
  defaultYear: number
  loading: boolean
  onSubmit: (payload: SkipRequestPayload) => void
  onCancel: () => void
}

const inputClass =
  'w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 min-h-[44px]'

export default function SkipRequestForm({
  defaultMonth,
  defaultYear,
  loading,
  onSubmit,
  onCancel,
}: SkipRequestFormProps) {
  const [category, setCategory] = useState<SkipReasonCategory | ''>('')
  const [recMonth, setRecMonth] = useState(defaultMonth)
  const [recYear, setRecYear] = useState(defaultYear)
  const [onSite, setOnSite] = useState(true)
  const [notes, setNotes] = useState('')

  const thisYear = new Date().getFullYear()
  const stop = isStopReason(category || null)
  const showReschedule = category !== '' && !stop

  function handleSubmit() {
    if (category === '') return
    onSubmit({
      skip_reason_category: category,
      skip_recommended_month: showReschedule ? recMonth : null,
      skip_recommended_year: showReschedule ? recYear : null,
      skip_equipment_on_site: showReschedule ? onSite : null,
      skip_reason: notes.trim(),
    })
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
      {/* Reason category */}
      <div>
        <label htmlFor="skipCategory" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Why should this PM be skipped? <span className="text-red-500">*</span>
        </label>
        <select
          id="skipCategory"
          value={category}
          onChange={(e) => setCategory(e.target.value as SkipReasonCategory | '')}
          className={inputClass}
        >
          <option value="" disabled>Select a reason…</option>
          {SKIP_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Reschedule: next-PM recommendation + on-site flag */}
      {showReschedule && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              When does the customer want the next PM?
            </label>
            <div className="flex gap-2">
              <select
                value={recMonth}
                onChange={(e) => setRecMonth(parseInt(e.target.value))}
                className={`${inputClass} flex-1`}
                aria-label="Next PM month"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={recYear}
                onChange={(e) => setRecYear(parseInt(e.target.value))}
                className={`${inputClass} w-28`}
                aria-label="Next PM year"
              >
                {[thisYear, thisYear + 1, thisYear + 2].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              The office uses this as the default when rescheduling.
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Is the equipment still on site?
            </span>
            <div className="flex gap-2">
              {[{ v: true, label: 'Yes' }, { v: false, label: 'No' }].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setOnSite(opt.v)}
                  className={`flex-1 px-4 py-3 sm:py-2 text-sm font-medium rounded-md border min-h-[44px] transition-colors ${
                    onSite === opt.v
                      ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-700 dark:border-slate-700'
                      : 'bg-white text-gray-700 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Stop reasons: explain the consequence */}
      {stop && (
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
          This will prompt the office to stop future PMs for this equipment.
        </p>
      )}

      {/* Optional notes */}
      <div>
        <label htmlFor="skipNotes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Additional notes <span className="text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <textarea
          id="skipNotes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything else the office should know…"
          rows={3}
          className={inputClass}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || category === ''}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          {loading ? 'Submitting…' : 'Submit Skip Request'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
