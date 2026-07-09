'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Minimal shape SkipDialog actually consumes — kept narrow so both
// TicketWithJoins (board listing) and TicketDetail (detail page) satisfy it.
// month/year/work_order_number are required-non-null in the DB.
export interface SkippableTicket {
  id: string
  month: number
  year: number
  work_order_number: number
  customers: { name: string } | null
  equipment: { make: string | null; model: string | null } | null
  pm_schedules: { interval_months: number; anchor_month: number } | null
}

interface SkipDialogProps {
  tickets: SkippableTicket[]
  // When the tech relayed a recommended next-PM month/year, seed the picker with
  // it instead of the calculated cycle default (detail-page approval only).
  recommendedMonth?: number
  recommendedYear?: number
  // Pre-check "stop future PMs" when the skip reason implies the equipment is gone.
  suggestStop?: boolean
  onClose: () => void
  onDone: () => void
}

function calcDefaultNextMonth(
  intervalMonths: number,
  anchorMonth: number,
  ticketMonth: number,
  ticketYear: number
): { month: number; year: number } {
  // Find the next scheduled month AFTER the ticket's month
  for (let offset = 1; offset <= 12; offset++) {
    const candidateMonth = ((ticketMonth - 1 + offset) % 12) + 1
    const candidateYear = ticketYear + Math.floor((ticketMonth - 1 + offset) / 12)

    const diff = ((candidateMonth - anchorMonth) % intervalMonths + intervalMonths) % intervalMonths
    if (diff === 0) {
      return { month: candidateMonth, year: candidateYear }
    }
  }
  // Fallback: next month
  const nextMonth = (ticketMonth % 12) + 1
  const nextYear = ticketMonth === 12 ? ticketYear + 1 : ticketYear
  return { month: nextMonth, year: nextYear }
}

export default function SkipDialog({ tickets, recommendedMonth, recommendedYear, suggestStop, onClose, onDone }: SkipDialogProps) {
  const router = useRouter()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const thisYear = new Date().getFullYear()
  const ticket = tickets[currentIndex]

  // Calculate default next service month from schedule
  const schedule = ticket?.pm_schedules
  const defaultNext = schedule
    ? calcDefaultNextMonth(schedule.interval_months, schedule.anchor_month, ticket.month, ticket.year)
    : { month: ((ticket?.month ?? 1) % 12) + 1, year: ticket?.month === 12 ? (ticket?.year ?? thisYear) + 1 : (ticket?.year ?? thisYear) }

  const [selectedMonth, setSelectedMonth] = useState(recommendedMonth ?? defaultNext.month)
  const [selectedYear, setSelectedYear] = useState(recommendedYear ?? defaultNext.year)
  const [stopSchedule, setStopSchedule] = useState(suggestStop ?? false)

  if (!ticket) return null

  const isLast = currentIndex === tickets.length - 1
  const total = tickets.length

  async function handleSkip() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          stopSchedule
            ? { status: 'skipped', deactivate_schedule: true }
            : { status: 'skipped', reschedule_month: selectedMonth }
        ),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(data.error ?? `Server error ${res.status}`)
      }

      if (isLast) {
        onDone()
        router.refresh()
      } else {
        // Advance to next ticket
        const nextIndex = currentIndex + 1
        const nextTicket = tickets[nextIndex]
        const nextSchedule = nextTicket?.pm_schedules
        const nextDefault = nextSchedule
          ? calcDefaultNextMonth(nextSchedule.interval_months, nextSchedule.anchor_month, nextTicket.month, nextTicket.year)
          : { month: ((nextTicket?.month ?? 1) % 12) + 1, year: nextTicket?.month === 12 ? (nextTicket?.year ?? thisYear) + 1 : (nextTicket?.year ?? thisYear) }

        setCurrentIndex(nextIndex)
        setSelectedMonth(nextDefault.month)
        setSelectedYear(nextDefault.year)
        setStopSchedule(false)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to skip ticket.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="md" dismissible={!loading} className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Skip PM Ticket</h3>
        {total > 1 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {currentIndex + 1} of {total}
          </span>
        )}
      </div>

      {/* Ticket info */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-3 mb-4 space-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          {ticket.customers?.name ?? '—'}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {[ticket.equipment?.make, ticket.equipment?.model].filter(Boolean).join(' ') || '—'}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          WO-{ticket.work_order_number} · {MONTHS[(ticket.month ?? 1) - 1]} {ticket.year}
        </p>
      </div>

      {/* Next service date picker — hidden when stopping the schedule */}
      {!stopSchedule && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Next Service Date
          </label>
          <div className="flex gap-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              disabled={loading}
              className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              disabled={loading}
              className="w-24 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {[thisYear, thisYear + 1, thisYear + 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {schedule && (
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Regular schedule: every {schedule.interval_months} month{schedule.interval_months > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Stop future PMs — deactivates the recurring schedule */}
      <label className="flex items-start gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={stopSchedule}
          onChange={(e) => setStopSchedule(e.target.checked)}
          disabled={loading}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">
          Stop future PMs for this equipment
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            Deactivates the recurring schedule — no new PM tickets will be generated.
          </span>
        </span>
      </label>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-md p-2 text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
        >
          {loading
            ? 'Processing...'
            : stopSchedule
              ? 'Skip & Stop PMs'
              : isLast
                ? 'Skip'
                : 'Skip & Next'}
        </button>
      </div>
    </Modal>
  )
}
