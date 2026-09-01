'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import type { ServiceBillingTicket } from '@/lib/db/service-tickets'
import { LEGACY_BILLING_TYPE_LABELS } from '@/lib/service-tickets/warranty'
import BillingNotesDrawer from './BillingNotesDrawer'
import InlineEditCell from './InlineEditCell'
import TicketTypeBadge from '@/components/TicketTypeBadge'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { formatDateShort } from '@/lib/format'
import { FIELDS } from '@/lib/labels'
import { matchesSearch } from '@/lib/search'

// "Ready to Export" — completed service tickets not yet exported. Export is the
// first half of the export-first billing flow (mirrors the PM Ready-to-Export
// list): clicking Export downloads the ticket's work-order PDF AND flips
// billing_exported=true, moving the ticket to the "Awaiting Invoice #" queue
// below where the coordinator keys the Synergy invoice # and marks it billed.
//
// Two ways to export, both landing in the same place:
//   - per row, via each row's Export button (one work order, one file)
//   - in bulk, via the checkboxes + Export Selected (feedback #95 — this was
//     the only list on /billing with no bulk select, so clearing a month of
//     service tickets meant one click and one download per ticket)
// Bulk goes through /api/billing/service/export-pdf, which composes the selected
// work orders into ONE PDF, a page each. That indirection exists because
// browsers block multi-file programmatic downloads — the reason this list was
// per-row only to begin with.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// A ticket's customer requires a PO but none is on the ticket yet — shown as an
// informational status here (PO Status column, amber banner), never blocking
// export. The PO is required later, at Mark Billed. Mirrors the PM
// Ready-to-Export gate in BillingExport.tsx.
function needsPo(t: ServiceBillingTicket): boolean {
  return !!t.customers?.po_required && !t.po_number
}

interface ServiceBillingExportProps {
  tickets: ServiceBillingTicket[]
  // Active narrowing filter from the URL. undefined → "All months" (default).
  selectedMonth?: number
  selectedYear?: number
  // Free-text query owned by ServiceBillingPanel — the same box filters this
  // list and Awaiting Invoice # below it. '' shows everything.
  search?: string
}

// Fields the tab's search box matches against — everything a coordinator would
// recognise a service ticket by, including the numbers keyed into Synergy
// (feedback #92).
function serviceBillingHaystack(t: ServiceBillingTicket) {
  return [
    t.work_order_number,
    t.customers?.name,
    t.customers?.account_number,
    shipToLabel(t),
    t.equipment?.make ?? t.equipment_make,
    t.equipment?.model ?? t.equipment_model,
    t.equipment?.serial_number,
    t.assigned_technician?.name,
    t.po_number,
    t.synergy_order_number,
  ]
}

// 0 is the "All months" sentinel for the month picker — no date narrowing.
const ALL_MONTHS = 0

type ServiceBillingSortKey =
  | 'customer'
  | 'wo'
  | 'poStatus'
  | 'equipment'
  | 'technician'
  | 'billing'
  | 'ticketType'
  | 'type'
  | 'completed'

const SERVICE_BILLING_SORT_ACCESSORS: SortAccessors<ServiceBillingTicket, ServiceBillingSortKey> = {
  customer: t => t.customers?.name,
  wo: t => t.work_order_number,
  // Group PO-needed rows first (they block Mark Billed), then has-PO, then not-required.
  poStatus: t => (needsPo(t) ? 0 : t.customers?.po_required ? 1 : 2),
  equipment: t =>
    [t.equipment?.make ?? t.equipment_make, t.equipment?.model ?? t.equipment_model]
      .filter(Boolean)
      .join(' ') || null,
  technician: t => t.assigned_technician?.name,
  billing: t => customerAmount(t),
  ticketType: t => t.ticket_type,
  type: t => LEGACY_BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type,
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

// What the customer actually pays (warranty coverage netted out) — the
// billing_amount is the full-price claim artifact vendors require, so once
// coverage is verified customer_bill_amount is the number that belongs here.
// NULL means "same as billing_amount" (not verified, or denied).
function customerAmount(t: ServiceBillingTicket): number | null {
  return t.customer_bill_amount ?? t.billing_amount
}

export default function ServiceBillingExport({
  tickets,
  selectedMonth,
  selectedYear,
  search = '',
}: ServiceBillingExportProps) {
  const router = useRouter()
  const thisYear = new Date().getFullYear()
  const [month, setMonth] = useState(selectedMonth ?? ALL_MONTHS)
  const [year, setYear] = useState(selectedYear ?? thisYear)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  // Default to nothing selected so bulk export is an intentional opt-in
  // (feedback #26, same rule as the PM list).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkExporting, setBulkExporting] = useState(false)
  const [notesCustomer, setNotesCustomer] = useState<{ id: number; name: string } | null>(null)

  // Deliberately counted over the UNFILTERED list: the banner reports a
  // condition that blocks billing, so a search must never hide it.
  const poMissingCount = tickets.filter(needsPo).length

  const visible = useMemo(
    () => tickets.filter((t) => matchesSearch(serviceBillingHaystack(t), search)),
    [tickets, search]
  )

  // Selection is derived from the full `tickets` list, not `visible`, which
  // does two jobs at once:
  //
  //  1. A search never drops a ticket you ticked — the convention the sibling
  //     billing lists set: search one customer, tick their rows, search another
  //     and tick more, then export once. Hidden-but-ticked rows ARE exported,
  //     and hiddenSelectedCount below warns about them.
  //  2. A stale id still falls out. Changing the month re-renders the server
  //     component with a different ticket list while this client component (and
  //     its Set) survives; a row that left the board entirely is not in
  //     `tickets`, so it can't be sent to the route's strict count check.
  const selectedTickets = tickets.filter((t) => selected.has(t.id))
  const selectedTotal = selectedTickets.reduce((sum, t) => sum + (customerAmount(t) ?? 0), 0)

  // The header/toolbar select-all reflects the rows on screen, so it can still
  // read "select all" while off-screen rows are already ticked.
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))
  const visibleIds = new Set(visible.map((t) => t.id))
  const hiddenSelectedCount = selectedTickets.filter((t) => !visibleIds.has(t.id)).length
  const busy = bulkExporting || exportingId !== null

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ServiceBillingTicket,
    ServiceBillingSortKey
  >(visible, SERVICE_BILLING_SORT_ACCESSORS)

  function toggleSelect(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  // Only ever adds or removes the rows currently on screen — selections the
  // search is hiding are left alone (mirrors ServiceAwaitingInvoice).
  function toggleAll() {
    const next = new Set(selected)
    for (const t of visible) {
      if (allVisibleSelected) next.delete(t.id)
      else next.add(t.id)
    }
    setSelected(next)
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

  // Export = download the work-order PDF (the artifact the coordinator keys into
  // Synergy), THEN flip billing_exported so the ticket moves to Awaiting Invoice #.
  // PDF-first so a render failure leaves the ticket in Ready to Export (idempotent
  // retry), mirroring the render-then-mark ordering in the PM /api/billing/pdf route.
  async function handleExport(ticketId: string) {
    if (busy) return
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

  // Bulk export — one request, one combined PDF, one download. The route
  // renders before it flips billing_exported, so a failure here leaves every
  // selected ticket in Ready to Export and the retry is safe.
  async function handleBulkExport() {
    if (selectedTickets.length === 0 || busy) return
    setBulkExporting(true)
    setToast(null)
    try {
      const res = await fetch('/api/billing/service/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: selectedTickets.map((t) => t.id) }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to generate the combined work order PDF')
      }

      const count = Number(res.headers.get('X-Exported-Count')) || selectedTickets.length
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ??
        'service-work-orders.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setToast({
        message: `Exported — ${count} work order${count === 1 ? '' : 's'} downloaded in one PDF. ${count === 1 ? 'It' : 'They'} moved to Awaiting Invoice #.`,
        type: 'success',
      })
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setBulkExporting(false)
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

  // Shared onSave callbacks for the InlineEditCell instances below — same
  // PATCH endpoint, same error handling (toast + rethrow so the cell can show
  // its own fail tick and stay open) as before the extraction.
  async function savePo(ticketId: string, value: string) {
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}`, {
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

  function renderPoStatus(t: ServiceBillingTicket) {
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
      />
    )
  }

  async function saveSynergyOrder(ticketId: string, value: string) {
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}`, {
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

  function renderSynergyCell(t: ServiceBillingTicket) {
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

  // Export is no longer blocked by a missing PO — the Synergy order can be built
  // before the PO arrives (speeds counter pickups). The PO requirement now lands
  // at Mark Billed (Awaiting Invoice # queue + server gate). The PO Status column
  // stays so a PO on hand can still be recorded early.
  function renderExportButton(t: ServiceBillingTicket) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleExport(t.id) }}
        disabled={busy}
        className="px-3 py-1 text-xs font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Download this ticket's work order PDF and move it to Awaiting Invoice #"
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
            Ready to Export
            {tickets.length > 0
              ? search
                ? ` (${visible.length} of ${tickets.length})`
                : ` (${tickets.length})`
              : ''}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Completed service tickets. Export one at a time, or tick several and export them as a single combined PDF. Either way they move to Awaiting Invoice #.
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
          {/* Bulk export controls. The select-all lives here rather than only in
              the table header so it's reachable on mobile, where the list
              renders as cards with no header row. */}
          <div className="w-full lg:w-auto lg:ml-auto flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            {visible.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="self-start text-sm text-slate-700 dark:text-slate-300 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white"
              >
                {allVisibleSelected ? 'Clear selection' : `Select all ${visible.length}`}
              </button>
            )}
            {selectedTickets.length > 0 && (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selectedTickets.length} selected — ${selectedTotal.toFixed(2)}
                {hiddenSelectedCount > 0 && (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    {hiddenSelectedCount} hidden by your search
                  </span>
                )}
              </span>
            )}
            <button
              onClick={handleBulkExport}
              disabled={selectedTickets.length === 0 || busy}
              className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Download the selected work orders as one combined PDF and move them to Awaiting Invoice #"
            >
              {bulkExporting
                ? 'Generating PDF...'
                : `Export Selected${selectedTickets.length > 0 ? ` (${selectedTickets.length})` : ''}`}
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

      {/* PO waiting banner — informational. Export is allowed without a PO now;
          the PO is required later, at Mark Billed. */}
      {poMissingCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {poMissingCount} ticket{poMissingCount === 1 ? '' : 's'} {poMissingCount === 1 ? 'is' : 'are'} waiting on a PO. {poMissingCount === 1 ? 'It' : 'They'} can be exported now, but can&apos;t be marked billed until the PO is recorded.
        </div>
      )}

      {/* Billing list */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            {search
              ? 'No tickets ready to export match your search.'
              : month === ALL_MONTHS
                ? 'No completed service tickets ready to export.'
                : 'No completed service tickets ready to export for this period.'}
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((t) => (
                <div key={t.id} className="px-4 py-3 flex items-start gap-3" onClick={() => toggleSelect(t.id)}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select WO#${t.work_order_number ?? t.id}`}
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
                      {renderEquipment(t)}
                    </p>
                    {t.equipment?.serial_number && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        S/N {t.equipment.serial_number}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Tech: {t.assigned_technician?.name ?? '—'} · Hrs: {t.hours_worked ?? '—'} ·{' '}
                      {customerAmount(t) != null ? `$${customerAmount(t)!.toFixed(2)}` : '—'}
                      {t.customer_bill_amount != null && t.customer_bill_amount !== t.billing_amount
                        ? ` (claim $${(t.billing_amount ?? 0).toFixed(2)})`
                        : ''}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <TicketTypeBadge type={t.ticket_type} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {LEGACY_BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                        {t.work_order_number != null ? ` · WO#${t.work_order_number}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Completed:{' '}
                      {formatDateShort(t.completed_at)}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400" onClick={(e) => e.stopPropagation()}>
                      <span>PO:</span>
                      {renderPoStatus(t)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400" onClick={(e) => e.stopPropagation()}>
                      <span>{FIELDS.synergyOrder}:</span>
                      {renderSynergyCell(t)}
                    </div>
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
                    <th className="px-4 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="Select all shown tickets ready to export"
                        className="accent-slate-600 rounded border-gray-300 dark:border-gray-600"
                      />
                    </th>
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="WO#" colKey="wo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="PO Status" colKey="poStatus" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Billing" colKey="billing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Service Type" colKey="ticketType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400">{FIELDS.synergyOrder}</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          aria-label={`Select WO#${t.work_order_number ?? t.id}`}
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
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.work_order_number ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {renderPoStatus(t)}
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
                        {customerAmount(t) != null ? `$${customerAmount(t)!.toFixed(2)}` : '—'}
                        {t.customer_bill_amount != null && t.customer_bill_amount !== t.billing_amount && (
                          <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
                            claim ${(t.billing_amount ?? 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <TicketTypeBadge type={t.ticket_type} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {LEGACY_BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {formatDateShort(t.completed_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {renderSynergyCell(t)}
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
