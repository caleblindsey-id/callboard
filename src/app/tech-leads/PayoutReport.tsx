'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'

interface Props {
  leads: TechLeadWithJoins[]
}

function firstOfMonth(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1))
  return d.toISOString().slice(0, 10)
}

function lastOfMonth(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59))
  return d.toISOString().slice(0, 10)
}

function toPayoutPeriod(isoDate: string): string {
  // isoDate is YYYY-MM-DD (local/UTC-stripped); we just take the first 7.
  return isoDate.slice(0, 7)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMoney(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function escapeCsv(v: string | number | null): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export default function PayoutReport({ leads }: Props) {
  const router = useRouter()

  const now = new Date()
  // Default = previous calendar month (commission typically runs for the month just closed).
  const defaultMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const [from, setFrom] = useState<string>(firstOfMonth(defaultYear, defaultMonth))
  const [to, setTo]     = useState<string>(lastOfMonth(defaultYear, defaultMonth))
  const [includePaid, setIncludePaid] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const inRange = useMemo(() => {
    const fromTs = new Date(from + 'T00:00:00').getTime()
    const toTs   = new Date(to   + 'T23:59:59').getTime()
    return leads.filter(l => {
      if (l.status !== 'earned' && !(includePaid && l.status === 'paid')) return false
      if (!l.earned_at) return false
      const t = new Date(l.earned_at).getTime()
      return t >= fromTs && t <= toTs
    })
  }, [leads, from, to, includePaid])

  const totalAmount = inRange.reduce((sum, l) => sum + (l.bonus_amount ?? 0), 0)
  const earnedInRange = inRange.filter(l => l.status === 'earned')
  const allSelected = earnedInRange.length > 0 && earnedInRange.every(l => selected.has(l.id))
  const selectedSum = earnedInRange
    .filter(l => selected.has(l.id))
    .reduce((s, l) => s + (l.bonus_amount ?? 0), 0)

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(earnedInRange.map(l => l.id)))
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function exportCsv() {
    const header = [
      'Tech', 'Customer', 'Equipment', 'Bonus amount',
      'Earned date', 'Status', 'Paid date', 'Payout period',
    ]
    const rows = inRange.map(l => [
      l.submitter?.name ?? '',
      l.customers?.name ?? l.customer_name_text ?? '',
      [l.equipment?.make, l.equipment?.model, l.equipment?.serial_number ? `SN ${l.equipment.serial_number}` : '']
        .filter(Boolean).join(' / '),
      l.bonus_amount ?? '',
      l.earned_at ? l.earned_at.slice(0, 10) : '',
      l.status,
      l.paid_at ? l.paid_at.slice(0, 10) : '',
      l.payout_period ?? '',
    ])
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tech-lead-bonuses_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function markPaid() {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      setError('Select at least one lead to mark paid.')
      return
    }
    const period = toPayoutPeriod(to)
    const confirmed = window.confirm(
      `Mark ${ids.length} lead${ids.length === 1 ? '' : 's'} paid in period ${period}? Total: $${selectedSum.toFixed(2)}.`
    )
    if (!confirmed) return

    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/tech-leads/payout/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: ids, payout_period: period }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to mark leads paid.')
      setMessage(`Marked ${ids.length} paid (period ${period}).`)
      setSelected(new Set())
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark leads paid.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From (earned date)</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 pb-2">
          <input
            type="checkbox"
            checked={includePaid}
            onChange={e => setIncludePaid(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Include already-paid
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={inRange.length === 0}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={markPaid}
            disabled={submitting || selected.size === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Marking…' : `Mark paid (${selected.size})`}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}

      {/* Summary */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <p className="text-gray-700 dark:text-gray-300">
          <strong>{inRange.length}</strong> bonus{inRange.length === 1 ? '' : 'es'} in range ·{' '}
          <strong>{formatMoney(totalAmount)}</strong> total
        </p>
        <p className="text-gray-700 dark:text-gray-300">
          Selected: <strong>{selected.size}</strong> · {formatMoney(selectedSum)}
        </p>
        <p className="ml-auto text-gray-500 dark:text-gray-400">
          Default payout period from To-date: <strong>{toPayoutPeriod(to)}</strong>
        </p>
      </div>

      {/* Table */}
      {inRange.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">No bonuses earned in the selected range.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={earnedInRange.length === 0}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                </th>
                <th className="px-4 py-3">Tech</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3 text-right">Bonus</th>
                <th className="px-4 py-3">Earned</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {inRange.map(l => {
                const canSelect = l.status === 'earned'
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-3">
                      {canSelect ? (
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggleOne(l.id)}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white whitespace-nowrap">
                      {l.submitter?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-white">
                      {l.customers?.name ?? l.customer_name_text ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {l.equipment
                        ? [l.equipment.make, l.equipment.model].filter(Boolean).join(' ')
                        : l.equipment_description}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">
                      {formatMoney(l.bonus_amount)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(l.earned_at)}
                    </td>
                    <td className="px-4 py-3">
                      {l.status === 'paid' ? (
                        <span className="text-xs text-emerald-700 dark:text-emerald-400">
                          Paid {l.payout_period ? `(${l.payout_period})` : ''}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-400">Earned, unpaid</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
