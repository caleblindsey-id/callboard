'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TicketWithJoins } from '@/lib/db/tickets'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface BillingExportProps {
  tickets: TicketWithJoins[]
  defaultMonth: number
  defaultYear: number
}

export default function BillingExport({
  tickets,
  defaultMonth,
  defaultYear,
}: BillingExportProps) {
  const router = useRouter()
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(defaultMonth)
  const [year, setYear] = useState(defaultYear)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(tickets.map((t) => t.id))
  )
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [exporting, setExporting] = useState(false)

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    if (selected.size === tickets.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tickets.map((t) => t.id)))
    }
  }

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth)
    setYear(newYear)
    router.push(`/billing?month=${newMonth}&year=${newYear}`)
  }

  async function handleExport() {
    if (selected.size === 0 || exporting) return

    setExporting(true)
    setToast(null)

    try {
      const res = await fetch('/api/billing/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: Array.from(selected),
          month,
          year,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `PM-Billing-${MONTHS[month - 1]}-${year}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      setToast({ message: `PDF exported — ${selected.size} ticket(s) marked as billed.`, type: 'success' })
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const selectedTotal = tickets
    .filter((t) => selected.has(t.id))
    .reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)

  return (
    <>
      {/* Month picker — stacked on mobile, row on desktop */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => handleMonthChange(parseInt(e.target.value), year)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <select
              value={year}
              onChange={(e) => handleMonthChange(month, parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto lg:ml-auto flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            {selected.size > 0 && (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selected.size} selected — ${selectedTotal.toFixed(2)}
              </span>
            )}
            <button
              onClick={handleExport}
              disabled={selected.size === 0 || exporting}
              className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {exporting ? 'Generating PDF…' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`rounded-lg p-3 text-sm border ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
              : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Billing list */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No completed, unexported tickets for this period.
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {tickets.map((t) => (
                <div
                  key={t.id}
                  className="px-4 py-3"
                  onClick={() => toggleSelect(t.id)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-slate-600 rounded border-gray-300 dark:border-gray-600 mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {t.customers?.name ?? '—'}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {[t.equipment?.make, t.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Tech: {t.users?.name ?? '—'} · Hrs: {t.hours_worked ?? '—'} ·{' '}
                        {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Completed:{' '}
                        {t.completed_date
                          ? new Date(t.completed_date).toLocaleDateString()
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table — hidden on mobile */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selected.size === tickets.length && tickets.length > 0}
                        onChange={toggleAll}
                        className="accent-slate-600 rounded border-gray-300 dark:border-gray-600"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Technician</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Hours</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Billing</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="accent-slate-600 rounded border-gray-300 dark:border-gray-600"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {t.customers?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {[t.equipment?.make, t.equipment?.model]
                          .filter(Boolean)
                          .join(' ') || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.users?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                        {t.hours_worked ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                        {t.billing_amount != null
                          ? `$${t.billing_amount.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.completed_date
                          ? new Date(t.completed_date).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
