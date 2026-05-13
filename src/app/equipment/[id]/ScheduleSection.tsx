'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PmScheduleRow, BillingType } from '@/types/database'
import { MONTHS, INTERVAL_OPTIONS, describeSchedule } from '@/lib/utils/schedule'

const BILLING_TYPES: { value: BillingType; label: string }[] = [
  { value: 'flat_rate', label: 'Flat Rate' },
  { value: 'time_and_materials', label: 'Time & Materials' },
  { value: 'contract', label: 'Contract' },
]

interface ScheduleSectionProps {
  equipmentId: string
  schedule: PmScheduleRow | null
}

type BackfillSummary =
  | { kind: 'skipped' }
  | { kind: 'ok'; created: number; flagged: number; months: { month: number; year: number }[] }
  | { kind: 'partial'; error: string; created: number }

export default function ScheduleSection({ equipmentId, schedule }: ScheduleSectionProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(!schedule)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backfillSummary, setBackfillSummary] = useState<BackfillSummary | null>(null)

  const [intervalMonths, setIntervalMonths] = useState(schedule?.interval_months ?? 3)
  const [anchorMonth, setAnchorMonth] = useState(schedule?.anchor_month ?? 1)
  const [billingType, setBillingType] = useState<BillingType>(schedule?.billing_type ?? 'flat_rate')
  const [flatRate, setFlatRate] = useState(schedule?.flat_rate?.toString() ?? '')
  const [skipBackfill, setSkipBackfill] = useState(false)

  async function handleSave() {
    setLoading(true)
    setError(null)
    setBackfillSummary(null)

    const payload = {
      interval_months: intervalMonths,
      anchor_month: anchorMonth,
      billing_type: billingType,
      flat_rate: billingType === 'flat_rate' ? parseFloat(flatRate) || null : null,
    }

    if (schedule) {
      // Edit path: direct client update (unchanged — no backfill logic).
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('pm_schedules')
        .update(payload)
        .eq('id', schedule.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
    } else {
      // Create path: route through API so backfill can run server-side.
      const res = await fetch('/api/pm-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: equipmentId,
          ...payload,
          skip_backfill: skipBackfill,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Failed to create schedule')
        setLoading(false)
        return
      }

      const bf = data?.backfill
      if (bf?.skipped_by_user) {
        setBackfillSummary({ kind: 'skipped' })
      } else if (bf?.error) {
        setBackfillSummary({ kind: 'partial', error: bf.error, created: bf.created ?? 0 })
      } else if (bf) {
        setBackfillSummary({
          kind: 'ok',
          created: bf.created ?? 0,
          flagged: bf.flagged ?? 0,
          months: bf.months ?? [],
        })
      }
    }

    setEditing(false)
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          PM Schedule
        </h2>
        {schedule && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
          >
            Edit
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {backfillSummary && (
        <div
          className={`text-sm rounded-md px-3 py-2 mb-3 border ${
            backfillSummary.kind === 'partial'
              ? 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-900/30 dark:border-amber-800/60 dark:text-amber-200'
              : 'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-700/40 dark:border-slate-600 dark:text-slate-200'
          }`}
        >
          {backfillSummary.kind === 'skipped' && 'Schedule created. Backfill skipped.'}
          {backfillSummary.kind === 'ok' && (
            <>
              Schedule created. Backfilled {backfillSummary.created} PM ticket
              {backfillSummary.created === 1 ? '' : 's'}
              {backfillSummary.flagged > 0
                ? ` (${backfillSummary.flagged} flagged for review)`
                : ''}
              .
            </>
          )}
          {backfillSummary.kind === 'partial' && (
            <>
              Schedule created, but backfill failed partway: {backfillSummary.error}. Generate
              missing months manually from the Tickets board.
            </>
          )}
        </div>
      )}

      {!editing && schedule ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Frequency</span>
            <p className="text-gray-900 dark:text-white font-medium">{describeSchedule(schedule.interval_months, schedule.anchor_month)}</p>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Billing Type</span>
            <p className="text-gray-900 dark:text-white font-medium capitalize">
              {schedule.billing_type?.replace('_', ' ') ?? '—'}
            </p>
          </div>
          {schedule.billing_type === 'flat_rate' && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Flat Rate</span>
              <p className="text-gray-900 dark:text-white font-medium">
                {schedule.flat_rate != null ? `$${schedule.flat_rate.toFixed(2)}` : '—'}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
            <select
              value={intervalMonths}
              onChange={(e) => setIntervalMonths(parseInt(e.target.value))}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Starting month
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(first month this PM runs)</span>
            </label>
            <select
              value={anchorMonth}
              onChange={(e) => setAnchorMonth(parseInt(e.target.value))}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Billing Type</label>
            <select
              value={billingType}
              onChange={(e) => setBillingType(e.target.value as BillingType)}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {BILLING_TYPES.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          {billingType === 'flat_rate' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Flat Rate ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={flatRate}
                onChange={(e) => setFlatRate(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="0.00"
              />
            </div>
          )}
          {!schedule && (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 select-none">
              <input
                type="checkbox"
                checked={skipBackfill}
                onChange={(e) => setSkipBackfill(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-slate-700 focus:ring-slate-500"
              />
              <span>
                Skip backfill
                <span className="text-gray-500 dark:text-gray-400 font-normal ml-1">
                  (PMs already done outside CallBoard — don&apos;t auto-generate for prior months)
                </span>
              </span>
            </label>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : schedule ? 'Update Schedule' : 'Add Schedule'}
            </button>
            {schedule && (
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
