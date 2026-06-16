'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import type { ServiceBillingTicket } from '@/lib/db/service-tickets'
import BillingNotesDrawer from './BillingNotesDrawer'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

// "Ready to Export" — completed service tickets not yet exported. Export is the
// first half of the export-first billing flow (mirrors the PM Ready-to-Export
// list): clicking Export downloads the ticket's work-order PDF AND flips
// billing_exported=true, moving the ticket to the "Awaiting Invoice #" queue
// below where the coordinator keys the Synergy invoice # and marks it billed.
// Per-ticket PDFs mean export is per-row — browsers block multi-file programmatic
// downloads, so there's no batch export here.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const BILLING_TYPE_LABELS: Record<string, string> = {
  non_warranty: 'T&M',
  warranty: 'Warranty',
  partial_warranty: 'Partial Warranty',
}

interface ServiceBillingExportProps {
  tickets: ServiceBillingTicket[]
  // Active narrowing filter from the URL. undefined → "All months" (default).
  selectedMonth?: number
  selectedYear?: number
}

// 0 is the "All months" sentinel for the month picker — no date narrowing.
const ALL_MONTHS = 0

type ServiceBillingSortKey =
  | 'customer'
  | 'equipment'
  | 'technician'
  | 'billing'
  | 'type'
  | 'completed'

const SERVICE_BILLING_SORT_ACCESSORS: SortAccessors<ServiceBillingTicket, ServiceBillingSortKey> = {
  customer: t => t.customers?.name,
  equipment: t =>
    [t.equipment?.make ?? t.equipment_make, t.equipment?.model ?? t.equipment_model]
      .filter(Boolean)
      .join(' ') || null,
  technician: t => t.assigned_technician?.name,
  billing: t => t.billing_amount,
  type: t => BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type,
  completed: t => t.completed_at,
}

function renderEquipment(t: ServiceBillingTicket): string {
  const make = t.equipment?.make ?? t.equipment_make
  const model = t.equipment?.model ?? t.equipment_model
  return [make, model].filter(Boolean).join(' ') || '—'
}

// Compact ship-to label so identically-named machines can be told apart on the
// phone. Prefer the ticket's own service location (set on the work order, always
// current for outside work), then the equipment's home ship-to.
function shipToLabel(t: ServiceBillingTicket): string | null {
  const loc = t.equipment?.ship_to_locations
  return t.service_city || loc?.name || loc?.city || t.service_address || loc?.address || null
}

// Account # · ship-to, shown under the customer name. Both are optional;
// returns null when neither is known so we can skip the line entirely.
function customerSubline(t: ServiceBillingTicket): string | null {
  const acct = t.customers?.account_number
  const parts = [acct ? `Acct #${acct}` : null, shipToLabel(t)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export default function ServiceBillingExport({
  tickets,
  selectedMonth,
  selectedYear,
}: ServiceBillingExportProps) {
  const router = useRouter()
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(selectedMonth ?? ALL_MONTHS)
  const [year, setYear] = useState(selectedYear ?? thisYear)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [notesCustomer, setNotesCustomer] = useState<{ id: number; name: string } | null>(null)

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ServiceBillingTicket,
    ServiceBillingSortKey
  >(tickets, SERVICE_BILLING_SORT_ACCESSORS)

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

  // Export = download the work-order PDF (the artifact the coordinator keys into
  // Synergy), THEN flip billing_exported so the ticket moves to Awaiting Invoice #.
  // PDF-first so a render failure leaves the ticket in Ready to Export (idempotent
  // retry), mirroring the render-then-mark ordering in the PM /api/billing/pdf route.
  async function handleExport(ticketId: string) {
    if (exportingId) return
    setExportingId(ticketId)
    setToast(null)
    try {
      const pdfRes = await fetch(`/api/service-tickets/${ticketId}/work-order-pdf`, { method: 'POST' })
      if (!pdfRes.ok) {
        const d = await pdfRes.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to generate work order PDF')
      }
      const blob = await pdfRes.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        pdfRes.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'work-order.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      const exRes = await fetch('/api/billing/service/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [ticketId] }),
      })
      if (!exRes.ok) {
        const d = await exRes.json().catch(() => ({}))
        throw new Error(d.error || 'Work order downloaded, but the ticket could not be marked exported.')
      }

      setToast({
        message: 'Exported — work order downloaded. Ticket moved to Awaiting Invoice #.',
        type: 'success',
      })
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setExportingId(null)
    }
  }

  function renderNotesButton(t: ServiceBillingTicket) {
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

  function renderExportButton(t: ServiceBillingTicket) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleExport(t.id) }}
        disabled={exportingId === t.id}
        className="px-3 py-1 text-xs font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
        title="Download the work order PDF and move this ticket to Awaiting Invoice #"
      >
        {exportingId === t.id ? 'Exporting…' : 'Export'}
      </button>
    )
  }

  return (
    <>
      {/* Section header + month picker */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Ready to Export{tickets.length > 0 ? ` (${tickets.length})` : ''}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Completed service tickets. Export each to download its work order, then it moves to Awaiting Invoice #.
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
            {month === ALL_MONTHS
              ? 'No completed service tickets ready to export.'
              : 'No completed service tickets ready to export for this period.'}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((t) => (
                <div key={t.id} className="px-4 py-3">
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
                      {renderEquipment(t)}
                    </p>
                    {t.equipment?.serial_number && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        S/N {t.equipment.serial_number}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Tech: {t.assigned_technician?.name ?? '—'} · Hrs: {t.hours_worked ?? '—'} ·{' '}
                      {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                      {t.work_order_number != null ? ` · WO#${t.work_order_number}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Completed:{' '}
                      {t.completed_at
                        ? new Date(t.completed_at).toLocaleDateString()
                        : '—'}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {renderExportButton(t)}
                      {renderNotesButton(t)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Billing" colKey="billing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {t.customers?.name ?? '—'}
                        {customerSubline(t) && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {customerSubline(t)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {renderEquipment(t)}
                        {t.equipment?.serial_number && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            S/N {t.equipment.serial_number}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.assigned_technician?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                        {t.billing_amount != null
                          ? `$${t.billing_amount.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.completed_at
                          ? new Date(t.completed_at).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {renderNotesButton(t)}
                          {renderExportButton(t)}
                        </div>
                      </td>
                    </tr>
                  ))}
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
    </>
  )
}
