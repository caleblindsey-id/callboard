'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TicketWithJoins } from '@/lib/db/tickets'
import BillingPreviewModal from './BillingPreviewModal'
import BillingNotesDrawer from './BillingNotesDrawer'
import InlineEditCell from './InlineEditCell'
import { MessageSquare } from 'lucide-react'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { formatDateShort } from '@/lib/format'
import { FIELDS } from '@/lib/labels'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface BillingExportProps {
  tickets: TicketWithJoins[]
  // Active narrowing filter from the URL. undefined → "All months" (default).
  selectedMonth?: number
  selectedYear?: number
}

function needsPo(t: TicketWithJoins): boolean {
  return !!t.customers?.po_required && !t.po_number
}

// Compact ship-to label so identically-named machines can be told apart on the
// phone. Mirrors the detail page resolution: the PM's snapshot ship-to first
// (set when a tech relocates equipment mid-PM), then the equipment's home
// ship-to. Prefer the location name, falling back to city then street.
function shipToLabel(t: TicketWithJoins): string | null {
  const loc = t.pm_ship_to ?? t.equipment?.ship_to_locations
  if (!loc) return null
  return loc.name || loc.city || loc.address || null
}

// Account # · ship-to, shown under the customer name. Both are optional;
// returns null when neither is known so we can skip the line entirely.
function customerSubline(t: TicketWithJoins): string | null {
  const acct = t.customers?.account_number
  const parts = [acct ? `Acct #${acct}` : null, shipToLabel(t)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

// 0 is the "All months" sentinel for the month picker — no date narrowing.
const ALL_MONTHS = 0

type BillingSortKey =
  | 'customer'
  | 'poStatus'
  | 'equipment'
  | 'technician'
  | 'hours'
  | 'billing'
  | 'terms'
  | 'completed'

const BILLING_SORT_ACCESSORS: SortAccessors<TicketWithJoins, BillingSortKey> = {
  customer: t => t.customers?.name,
  // Group PO-needed rows first (they block export), then has-PO, then not-required.
  poStatus: t => (needsPo(t) ? 0 : t.customers?.po_required ? 1 : 2),
  equipment: t => [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || null,
  technician: t => t.users?.name,
  hours: t => t.hours_worked,
  billing: t => t.billing_amount,
  terms: t => t.customers?.ar_terms,
  completed: t => t.completed_date,
}

export default function BillingExport({
  tickets,
  selectedMonth,
  selectedYear,
}: BillingExportProps) {
  const router = useRouter()
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(selectedMonth ?? ALL_MONTHS)
  const [year, setYear] = useState(selectedYear ?? thisYear)
  // Default to nothing selected so bulk export is an intentional opt-in (feedback #26).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [notesCustomer, setNotesCustomer] = useState<{ id: number; name: string } | null>(null)
  // Rows with an inline editor open — kept out of the "blocked" dim treatment
  // below so a coordinator isn't typing into a grayed-out row.
  const [editingRowIds, setEditingRowIds] = useState<Set<string>>(new Set())

  function setRowEditing(ticketId: string, editing: boolean) {
    setEditingRowIds((prev) => {
      const next = new Set(prev)
      if (editing) next.add(ticketId)
      else next.delete(ticketId)
      return next
    })
  }

  const poMissingCount = tickets.filter(needsPo).length

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    TicketWithJoins,
    BillingSortKey
  >(tickets, BILLING_SORT_ACCESSORS)

  function toggleSelect(id: string) {
    const ticket = tickets.find((t) => t.id === id)
    if (ticket && needsPo(ticket)) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    const selectable = tickets.filter((t) => !needsPo(t))
    if (selected.size === selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map((t) => t.id)))
    }
  }

  function handleMonthChange(newMonth: number, newYear: number) {
    setMonth(newMonth)
    setYear(newYear)
    // Preserve any other params (e.g. the active ?tab) the page owns.
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
    )
    // "All months" clears the filter so the queue shows every unbilled ticket.
    if (newMonth === ALL_MONTHS) {
      params.delete('month')
      params.delete('year')
    } else {
      params.set('month', String(newMonth))
      params.set('year', String(newYear))
    }
    const qs = params.toString()
    router.push(qs ? `/billing?${qs}` : '/billing')
  }

  // Shared onSave callbacks for the InlineEditCell instances below — same
  // PATCH endpoint, same error handling (toast + rethrow so the cell can show
  // its own fail tick and stay open) as before the extraction.
  async function savePo(ticketId: string, value: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_number: value }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save PO number.'
      setToast({ message, type: 'error' })
      throw err
    }
  }

  async function saveSynergyOrder(ticketId: string, value: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synergy_order_number: value }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Synergy Order #.'
      setToast({ message, type: 'error' })
      throw err
    }
  }

  async function handleExport() {
    if (selected.size === 0 || exporting) return

    setExporting(true)
    setToast(null)

    // The PDF header/filename need a concrete period. Under "All months" the
    // selection can span completion months, so label it with the current
    // billing-run period (when the coordinator is keying into Synergy).
    const now = new Date()
    const pdfMonth = month === ALL_MONTHS ? now.getMonth() + 1 : month
    const pdfYear = month === ALL_MONTHS ? now.getFullYear() : year

    try {
      const res = await fetch('/api/billing/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: Array.from(selected),
          month: pdfMonth,
          year: pdfYear,
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
      a.download = `PM-Billing-${MONTHS[pdfMonth - 1]}-${pdfYear}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      setToast({ message: `PDF exported — ${selected.size} ticket(s) now awaiting a Synergy invoice #. Enter it below to mark them billed.`, type: 'success' })
      setSelected(new Set())
      setPreviewOpen(false)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  // Pre-export gate: open the modal so the user can eyeball the line items
  // before any PDF render or DB write happens.
  function handlePreviewExport() {
    if (selected.size === 0 || exporting) return
    setPreviewOpen(true)
  }

  const selectedTotal = tickets
    .filter((t) => selected.has(t.id))
    .reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)

  const selectableCount = tickets.filter((t) => !needsPo(t)).length

  function renderPoStatus(t: TicketWithJoins) {
    if (!t.customers?.po_required) return <span className="text-gray-400 dark:text-gray-600">—</span>
    return (
      <InlineEditCell
        value={t.po_number}
        placeholder="PO #"
        onSave={(v) => savePo(t.id, v)}
        emptyVariant="pill"
        emptyText="PO Needed"
        valueClassName="text-green-700 dark:text-green-400"
        inputWidthClassName="w-24"
        valueMaxWidthClassName="max-w-[120px]"
        readOnlyWhenSet
        onEditingChange={(editing) => setRowEditing(t.id, editing)}
      />
    )
  }

  function renderSynergyCell(t: TicketWithJoins) {
    return (
      <InlineEditCell
        value={t.synergy_order_number}
        placeholder="Synergy Order #"
        onSave={(v) => saveSynergyOrder(t.id, v)}
        emptyVariant="ghost"
        emptyText="+ Synergy Order #"
        valueClassName="text-gray-700 dark:text-gray-300"
      />
    )
  }

  function renderNotesButton(t: TicketWithJoins) {
    if (t.customer_id == null) return null
    const customerId = t.customer_id
    const customerName = t.customers?.name ?? '—'
    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          setNotesCustomer({ id: customerId, name: customerName })
        }}
        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
        title="Billing notes for this customer"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Notes
      </button>
    )
  }

  return (
    <>
      {/* Section header + month picker — mirrors ServiceBillingExport's shape
          (title/description block, then the toolbar row) so the two Ready to
          Export blocks read as one pattern (billing-1/billing-4). */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Ready to Export{tickets.length > 0 ? ` (${tickets.length})` : ''}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Completed PM tickets. Select the ones ready to bill, then export a combined PDF.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-3">
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Month</label>
            <select
              value={month}
              onChange={(e) => handleMonthChange(parseInt(e.target.value), year)}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value={ALL_MONTHS}>All months</option>
              {MONTHS.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="w-full lg:w-auto">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Year</label>
            <select
              value={year}
              disabled={month === ALL_MONTHS}
              onChange={(e) => handleMonthChange(month, parseInt(e.target.value))}
              className="w-full lg:w-auto rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
              onClick={handlePreviewExport}
              disabled={selected.size === 0 || exporting}
              className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {exporting ? 'Generating PDF...' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* PO missing banner */}
      {poMissingCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {poMissingCount} ticket{poMissingCount === 1 ? '' : 's'} require{poMissingCount === 1 ? 's' : ''} a PO number before {poMissingCount === 1 ? 'it' : 'they'} can be exported.
        </div>
      )}

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
            {month === ALL_MONTHS
              ? 'No completed, unexported tickets ready to bill.'
              : 'No completed, unexported tickets for this period.'}
          </div>
        ) : (
          <>
            {/* Mobile cards — hidden on desktop */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((t) => {
                const blocked = needsPo(t)
                return (
                  <div
                    key={t.id}
                    className={`px-4 py-3 ${blocked && !editingRowIds.has(t.id) ? 'opacity-50' : ''}`}
                    onClick={() => toggleSelect(t.id)}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={blocked}
                        className="accent-slate-600 rounded border-gray-300 dark:border-gray-600 mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {t.customers?.name ?? '—'}
                        </p>
                        {customerSubline(t) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {customerSubline(t)}
                          </p>
                        )}
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {[t.equipment?.make, t.equipment?.model]
                            .filter(Boolean)
                            .join(' ') || '—'}
                        </p>
                        {t.equipment?.serial_number && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            S/N {t.equipment.serial_number}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Tech: {t.users?.name ?? '—'} · Hrs: {t.hours_worked ?? '—'} ·{' '}
                          {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Terms: {t.customers?.ar_terms ?? '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Completed:{' '}
                          {formatDateShort(t.completed_date)}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {renderPoStatus(t)}
                          {renderNotesButton(t)}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400" onClick={(e) => e.stopPropagation()}>
                          <span>{FIELDS.synergyOrder}:</span>
                          {renderSynergyCell(t)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table — hidden on mobile */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectableCount > 0 && selected.size === selectableCount}
                        onChange={toggleAll}
                        disabled={selectableCount === 0}
                        className="accent-slate-600 rounded border-gray-300 dark:border-gray-600"
                      />
                    </th>
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="PO Status" colKey="poStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Hours" colKey="hours" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Billing" colKey="billing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Terms" colKey="terms" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">{FIELDS.synergyOrder}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((t) => {
                    const blocked = needsPo(t)
                    return (
                      <tr key={t.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${blocked && !editingRowIds.has(t.id) ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggleSelect(t.id)}
                            disabled={blocked}
                            className="accent-slate-600 rounded border-gray-300 dark:border-gray-600"
                          />
                        </td>
                        <td className="px-4 py-3 text-gray-900 dark:text-white">
                          {t.customers?.name ?? '—'}
                          {customerSubline(t) && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                              {customerSubline(t)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {renderPoStatus(t)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {[t.equipment?.make, t.equipment?.model]
                            .filter(Boolean)
                            .join(' ') || '—'}
                          {t.equipment?.serial_number && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                              S/N {t.equipment.serial_number}
                            </span>
                          )}
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
                          {t.customers?.ar_terms ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {formatDateShort(t.completed_date)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {renderSynergyCell(t)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {renderNotesButton(t)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>

      <BillingNotesDrawer
        customerId={notesCustomer?.id ?? null}
        customerName={notesCustomer?.name ?? null}
        onClose={() => setNotesCustomer(null)}
      />

      <BillingPreviewModal
        open={previewOpen}
        tickets={tickets.filter((t) => selected.has(t.id))}
        exporting={exporting}
        onCancel={() => {
          if (exporting) return
          setPreviewOpen(false)
        }}
        onConfirm={handleExport}
      />
    </>
  )
}
