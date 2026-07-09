'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import type { ServiceBillingTicket } from '@/lib/db/service-tickets'
import BillingNotesDrawer from './BillingNotesDrawer'
import TicketTypeBadge from '@/components/TicketTypeBadge'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'
import { FIELDS } from '@/lib/labels'

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

// A ticket is blocked from export when its customer requires a PO but none is on
// the ticket yet — mirrors the PM Ready-to-Export gate in BillingExport.tsx.
function needsPo(t: ServiceBillingTicket): boolean {
  return !!t.customers?.po_required && !t.po_number
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
  | 'poStatus'
  | 'equipment'
  | 'technician'
  | 'billing'
  | 'ticketType'
  | 'type'
  | 'completed'

const SERVICE_BILLING_SORT_ACCESSORS: SortAccessors<ServiceBillingTicket, ServiceBillingSortKey> = {
  customer: t => t.customers?.name,
  // Group PO-needed rows first (they block export), then has-PO, then not-required.
  poStatus: t => (needsPo(t) ? 0 : t.customers?.po_required ? 1 : 2),
  equipment: t =>
    [t.equipment?.make ?? t.equipment_make, t.equipment?.model ?? t.equipment_model]
      .filter(Boolean)
      .join(' ') || null,
  technician: t => t.assigned_technician?.name,
  billing: t => t.billing_amount,
  ticketType: t => t.ticket_type,
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

  // Inline Synergy order # editing — lets the coordinator key the parts-order #
  // BEFORE exporting so it prints on the work order PDF, making it easy to match
  // the exported WO back to its Synergy record when entering the invoice # later
  // (feedback #48). Writes the same synergy_order_number column the parts-ordering
  // and Awaiting Invoice flows use. Optional — never blocks export.
  const [synergyEditingId, setSynergyEditingId] = useState<string | null>(null)
  const [synergyEditingValue, setSynergyEditingValue] = useState('')
  const [synergySaving, setSynergySaving] = useState(false)

  // Inline PO editing — for PO-required customers a PO must be on the ticket
  // before it can be exported (mirrors the PM Ready-to-Export gate).
  const [editingPoId, setEditingPoId] = useState<string | null>(null)
  const [editingPoValue, setEditingPoValue] = useState('')
  const [savingPo, setSavingPo] = useState(false)

  const poMissingCount = tickets.filter(needsPo).length

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

  function startEditPo(ticketId: string) {
    setEditingPoId(ticketId)
    setEditingPoValue('')
  }

  function cancelEditPo() {
    setEditingPoId(null)
    setEditingPoValue('')
  }

  async function handleSavePo() {
    if (!editingPoId || savingPo) return
    const trimmed = editingPoValue.trim()
    if (!trimmed) return

    setSavingPo(true)
    try {
      const res = await fetch(`/api/service-tickets/${editingPoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_number: trimmed }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      setEditingPoId(null)
      setEditingPoValue('')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save PO number.'
      setToast({ message, type: 'error' })
    } finally {
      setSavingPo(false)
    }
  }

  function renderPoStatus(t: ServiceBillingTicket) {
    if (!t.customers?.po_required) return <span className="text-gray-400 dark:text-gray-600">—</span>
    if (t.po_number) {
      return (
        <span className="text-green-700 dark:text-green-400 truncate max-w-[120px] inline-block align-bottom" title={t.po_number}>
          {t.po_number}
        </span>
      )
    }
    // PO required but missing
    if (editingPoId === t.id) {
      return (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editingPoValue}
            onChange={(e) => setEditingPoValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSavePo()
              if (e.key === 'Escape') cancelEditPo()
            }}
            placeholder="PO #"
            autoFocus
            disabled={savingPo}
            className="w-24 rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={handleSavePo}
            disabled={savingPo || !editingPoValue.trim()}
            className="px-1.5 py-0.5 text-xs font-medium text-white bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"
          >
            {savingPo ? '...' : 'Save'}
          </button>
          <button
            onClick={cancelEditPo}
            disabled={savingPo}
            className="px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startEditPo(t.id) }}
        className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
      >
        PO Needed
      </button>
    )
  }

  function startSynergyEdit(ticketId: string, current: string | null) {
    setSynergyEditingId(ticketId)
    setSynergyEditingValue(current ?? '')
  }

  function cancelSynergyEdit() {
    setSynergyEditingId(null)
    setSynergyEditingValue('')
  }

  async function handleSaveSynergy() {
    if (!synergyEditingId || synergySaving) return
    const trimmed = synergyEditingValue.trim()
    if (!trimmed) return

    setSynergySaving(true)
    try {
      const res = await fetch(`/api/service-tickets/${synergyEditingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synergy_order_number: trimmed }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      setSynergyEditingId(null)
      setSynergyEditingValue('')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Synergy Order #.'
      setToast({ message, type: 'error' })
    } finally {
      setSynergySaving(false)
    }
  }

  function renderSynergyCell(t: ServiceBillingTicket) {
    if (synergyEditingId === t.id) {
      return (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={synergyEditingValue}
            onChange={(e) => setSynergyEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveSynergy()
              if (e.key === 'Escape') cancelSynergyEdit()
            }}
            placeholder="Synergy Order #"
            autoFocus
            disabled={synergySaving}
            className="w-28 rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={handleSaveSynergy}
            disabled={synergySaving || !synergyEditingValue.trim()}
            className="px-1.5 py-0.5 text-xs font-medium text-white bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"
          >
            {synergySaving ? '...' : 'Save'}
          </button>
          <button
            onClick={cancelSynergyEdit}
            disabled={synergySaving}
            className="px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )
    }
    if (t.synergy_order_number) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); startSynergyEdit(t.id, t.synergy_order_number) }}
          title={`${t.synergy_order_number} — click to edit`}
          className="text-gray-700 dark:text-gray-300 truncate max-w-[140px] inline-block align-bottom hover:underline"
        >
          {t.synergy_order_number}
        </button>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startSynergyEdit(t.id, null) }}
        className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:underline"
      >
        + Synergy Order #
      </button>
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
        disabled={exportingId === t.id}
        className="px-3 py-1 text-xs font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      {/* PO waiting banner — informational. Export is allowed without a PO now;
          the PO is required later, at Mark Billed. */}
      {poMissingCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {poMissingCount} ticket{poMissingCount === 1 ? '' : 's'} {poMissingCount === 1 ? 'is' : 'are'} waiting on a PO. {poMissingCount === 1 ? 'It' : 'They'} can be exported now, but can&apos;t be marked billed until the PO is recorded.
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
                    <div className="mt-0.5 flex items-center gap-2">
                      <TicketTypeBadge type={t.ticket_type} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                        {t.work_order_number != null ? ` · WO#${t.work_order_number}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Completed:{' '}
                      {t.completed_at
                        ? new Date(t.completed_at).toLocaleDateString()
                        : '—'}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>PO:</span>
                      {renderPoStatus(t)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
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
                    <SortHeader label="Customer" colKey="customer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
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
                      <td className="px-4 py-3">
                        <TicketTypeBadge type={t.ticket_type} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.completed_at
                          ? new Date(t.completed_at).toLocaleDateString()
                          : '—'}
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
