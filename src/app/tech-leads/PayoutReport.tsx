'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import type { AceLaborEntryWithJoins } from '@/lib/db/ace-labor'
import { tierLabel } from '@/lib/tech-leads/bonus-tiers'
import ConfirmDialog from './ConfirmDialog'
import { formatMoney, formatDate } from '@/lib/format'

interface Props {
  leads: TechLeadWithJoins[]
  aceEntries: AceLaborEntryWithJoins[]
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

function escapeCsv(v: string | number | null): string {
  if (v == null) return ''
  let s = String(v)
  // Formula-injection guard: if the value starts with a spreadsheet trigger
  // char, prefix with a single-quote so Excel/Sheets treats it as text.
  if (/^[=+\-@]/.test(s)) {
    s = `'${s}`
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export default function PayoutReport({ leads, aceEntries }: Props) {
  const router = useRouter()

  const now = new Date()
  // Default = previous calendar month (commission typically runs for the month just closed).
  const defaultMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const [from, setFrom] = useState<string>(firstOfMonth(defaultYear, defaultMonth))
  const [to, setTo]     = useState<string>(lastOfMonth(defaultYear, defaultMonth))
  const [includePaid, setIncludePaid] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedAce, setSelectedAce] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submittingAce, setSubmittingAce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // Inline confirm replacements for window.confirm.
  const [confirmMarkPaidOpen, setConfirmMarkPaidOpen] = useState(false)
  const [confirmAceMarkPaidOpen, setConfirmAceMarkPaidOpen] = useState(false)

  const inRange = useMemo(() => {
    // UTC anchoring on both boundaries so the range matches the UTC dates the
    // firstOfMonth / lastOfMonth helpers produce.
    const fromTs = new Date(from + 'T00:00:00Z').getTime()
    const toTs   = new Date(to   + 'T23:59:59Z').getTime()
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

  // ACE labor: filter by approved_at, same date range. Approved = unpaid;
  // paid is gated by the same includePaid checkbox so the manager can see
  // the full picture without ACE living off in its own pseudo-mode.
  const aceInRange = useMemo(() => {
    const fromTs = new Date(from + 'T00:00:00Z').getTime()
    const toTs   = new Date(to   + 'T23:59:59Z').getTime()
    return aceEntries.filter(e => {
      if (e.status !== 'approved' && !(includePaid && e.status === 'paid')) return false
      if (!e.approved_at) return false
      const t = new Date(e.approved_at).getTime()
      return t >= fromTs && t <= toTs
    })
  }, [aceEntries, from, to, includePaid])

  function aceBillableValue(e: AceLaborEntryWithJoins): number {
    const rate = Number(e.rate_value_at_approval ?? 0) || 0
    const hrs  = Number(e.hours) || 0
    return rate * hrs
  }

  const aceApprovedInRange = aceInRange.filter(e => e.status === 'approved')
  const allAceSelected = aceApprovedInRange.length > 0 && aceApprovedInRange.every(e => selectedAce.has(e.id))
  const selectedAceSum = aceApprovedInRange
    .filter(e => selectedAce.has(e.id))
    .reduce((s, e) => s + aceBillableValue(e), 0)
  const aceTotalValue = aceInRange.reduce((s, e) => s + aceBillableValue(e), 0)

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

  function toggleAllAce() {
    if (allAceSelected) {
      setSelectedAce(new Set())
    } else {
      setSelectedAce(new Set(aceApprovedInRange.map(e => e.id)))
    }
  }

  function toggleOneAce(id: string) {
    const next = new Set(selectedAce)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedAce(next)
  }

  function exportCsv() {
    const header = [
      'Source',
      'Tech', 'Lead type', 'Customer', 'Equipment',
      'Hours', 'Hourly rate', 'Billable value', 'Bonus amount',
      'Earned date', 'Status', 'Paid date', 'Payout period',
      'Synergy order #', 'ACE reason',
    ]
    const leadRows = inRange.map(l => {
      const equipmentLabel = l.lead_type === 'equipment_sale'
        ? (l.sale_equipment_tier ?? l.proposed_equipment_tier ?? '')
        : [l.equipment?.make, l.equipment?.model, l.equipment?.serial_number ? `SN ${l.equipment.serial_number}` : '']
            .filter(Boolean).join(' / ')
      return [
        l.lead_type === 'equipment_sale' ? 'Equipment sale' : 'PM',
        l.submitter?.name ?? '',
        l.lead_type === 'equipment_sale' ? 'Equipment sale' : 'PM',
        l.customers?.name ?? l.customer_name_text ?? '',
        equipmentLabel,
        '', '', '',                          // Hours / Hourly rate / Billable value (n/a for bonuses)
        l.bonus_amount ?? '',
        l.earned_at ? l.earned_at.slice(0, 10) : '',
        l.status,
        l.paid_at ? l.paid_at.slice(0, 10) : '',
        l.payout_period ?? '',
        l.sale_synergy_order_number ?? '',
        '',                                  // ACE reason (n/a)
      ] as (string | number | null)[]
    })
    const aceRows = aceInRange.map(e => {
      const ticketLabel = e.pm_ticket
        ? `PM ${e.pm_ticket.work_order_number ?? e.pm_ticket.id.slice(0, 8)}`
        : e.service_ticket
          ? `Service ${e.service_ticket.work_order_number ?? e.service_ticket.id.slice(0, 8)}`
          : ''
      const customer = e.pm_ticket?.customers?.name ?? e.service_ticket?.customers?.name ?? ''
      const rate = Number(e.rate_value_at_approval ?? 0) || 0
      const hrs = Number(e.hours) || 0
      return [
        'ACE labor',
        e.tech?.name ?? '',
        `ACE labor (${e.labor_rate_type})`,
        customer,
        ticketLabel,
        hrs.toFixed(2),
        rate.toFixed(2),
        (rate * hrs).toFixed(2),
        '',                                  // Bonus amount (n/a)
        e.approved_at ? e.approved_at.slice(0, 10) : '',
        e.status,
        e.paid_at ? e.paid_at.slice(0, 10) : '',
        e.payout_period ?? '',
        '',                                  // Synergy order # (n/a)
        e.reason ?? '',
      ] as (string | number | null)[]
    })
    const csv = [header, ...leadRows, ...aceRows].map(r => r.map(escapeCsv).join(',')).join('\n')
    // UTF-8 BOM so Excel on Windows auto-detects encoding and renders accented
    // characters in customer/tech names correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tech-payouts_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function markPaid() {
    if (selected.size === 0) {
      setError('Select at least one lead to mark paid.')
      return
    }
    setError(null)
    setConfirmMarkPaidOpen(true)
  }

  async function performMarkPaid() {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      setConfirmMarkPaidOpen(false)
      return
    }
    const period = toPayoutPeriod(to)
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
      setConfirmMarkPaidOpen(false)
    }
  }

  function aceMarkPaid() {
    if (selectedAce.size === 0) {
      setError('Select at least one ACE entry to mark paid.')
      return
    }
    setError(null)
    setConfirmAceMarkPaidOpen(true)
  }

  async function performAceMarkPaid() {
    const ids = Array.from(selectedAce)
    if (ids.length === 0) {
      setConfirmAceMarkPaidOpen(false)
      return
    }
    const period = toPayoutPeriod(to)
    setSubmittingAce(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/ace-labor/payout/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_ids: ids, payout_period: period }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to mark ACE entries paid.')
      setMessage(`Marked ${ids.length} ACE entr${ids.length === 1 ? 'y' : 'ies'} paid (period ${period}).`)
      setSelectedAce(new Set())
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark ACE entries paid.')
    } finally {
      setSubmittingAce(false)
      setConfirmAceMarkPaidOpen(false)
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
            disabled={inRange.length === 0 && aceInRange.length === 0}
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
                      {l.lead_type === 'equipment_sale'
                        ? `${tierLabel(l.sale_equipment_tier ?? l.proposed_equipment_tier)}${l.sale_synergy_order_number ? ` · Synergy #${l.sale_synergy_order_number}` : ''}`
                        : l.equipment
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

      {/* ── ACE Labor section — same date range, separate mark-paid path ── */}
      <div className="pt-4 mt-2 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">ACE Labor</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Approved entries in this range · <strong>{aceInRange.length}</strong> · billable value <strong>${aceTotalValue.toFixed(2)}</strong>
              {selectedAce.size > 0 && (
                <> · selected <strong>{selectedAce.size}</strong> · ${selectedAceSum.toFixed(2)}</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={aceMarkPaid}
            disabled={submittingAce || selectedAce.size === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50"
          >
            {submittingAce ? 'Marking…' : `Mark ACE paid (${selectedAce.size})`}
          </button>
        </div>

        {aceInRange.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">No ACE labor approved in this range.</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allAceSelected}
                      onChange={toggleAllAce}
                      disabled={aceApprovedInRange.length === 0}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </th>
                  <th className="px-4 py-3">Tech</th>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                  <th className="px-4 py-3">Rate type</th>
                  <th className="px-4 py-3 text-right">Hourly rate</th>
                  <th className="px-4 py-3 text-right">Billable value</th>
                  <th className="px-4 py-3">Approved</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {aceInRange.map(e => {
                  const canSelect = e.status === 'approved'
                  const ticketLabel = e.pm_ticket
                    ? `PM ${e.pm_ticket.work_order_number ?? e.pm_ticket.id.slice(0, 8)}`
                    : e.service_ticket
                      ? `Service ${e.service_ticket.work_order_number ?? e.service_ticket.id.slice(0, 8)}`
                      : '—'
                  const customer = e.pm_ticket?.customers?.name ?? e.service_ticket?.customers?.name ?? '—'
                  const rate = Number(e.rate_value_at_approval ?? 0) || 0
                  const hrs = Number(e.hours) || 0
                  return (
                    <tr key={e.id}>
                      <td className="px-4 py-3">
                        {canSelect ? (
                          <input
                            type="checkbox"
                            checked={selectedAce.has(e.id)}
                            onChange={() => toggleOneAce(e.id)}
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white whitespace-nowrap">{e.tech?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{ticketLabel}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{customer}</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white whitespace-nowrap">{hrs.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 capitalize">{e.labor_rate_type}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">${rate.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">${(rate * hrs).toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(e.approved_at)}</td>
                      <td className="px-4 py-3">
                        {e.status === 'paid' ? (
                          <span className="text-xs text-emerald-700 dark:text-emerald-400">
                            Paid {e.payout_period ? `(${e.payout_period})` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-700 dark:text-amber-400">Approved, unpaid</span>
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

      <ConfirmDialog
        open={confirmMarkPaidOpen}
        title="Mark leads paid?"
        message={`Mark ${selected.size} lead${selected.size === 1 ? '' : 's'} paid in period ${toPayoutPeriod(to)}? Total: $${selectedSum.toFixed(2)}.`}
        confirmLabel="Mark paid"
        busy={submitting}
        onCancel={() => setConfirmMarkPaidOpen(false)}
        onConfirm={performMarkPaid}
      />

      <ConfirmDialog
        open={confirmAceMarkPaidOpen}
        title="Mark ACE labor paid?"
        message={`Mark ${selectedAce.size} ACE labor entr${selectedAce.size === 1 ? 'y' : 'ies'} paid in period ${toPayoutPeriod(to)}? Billable value: $${selectedAceSum.toFixed(2)}.`}
        confirmLabel="Mark paid"
        busy={submittingAce}
        onCancel={() => setConfirmAceMarkPaidOpen(false)}
        onConfirm={performAceMarkPaid}
      />
    </div>
  )
}
