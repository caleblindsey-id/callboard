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
import ConfirmDialog from '@/components/ConfirmDialog'
import { formatDateShort } from '@/lib/format'
import InlineEditCell from './InlineEditCell'

// Service tickets that have been exported (work-order PDF pulled) but are NOT yet
// billed. They become 'billed' only once a manager keys the SynergyERP invoice
// number — the checks-and-balance that proves the work was actually invoiced.
// Rendered UNDER the service "Ready to Export" list; the month picker on that list
// drives both queries, so this component intentionally has no picker of its own.
// Mirrors PmAwaitingInvoice.

const BILLING_TYPE_LABELS: Record<string, string> = {
  non_warranty: 'T&M',
  warranty: 'Warranty',
  partial_warranty: 'Partial Warranty',
}

interface ServiceAwaitingInvoiceProps {
  tickets: ServiceBillingTicket[]
}

function needsInvoice(t: ServiceBillingTicket): boolean {
  return !t.synergy_invoice_number?.trim()
}

// A PO-required customer can't be billed until a PO is on the ticket. The
// Ready-to-Export gate was relaxed (the Synergy order can be built before the
// PO arrives), so a PO-required ticket can now reach this queue without a PO —
// it's recorded here, and blocks Mark Billed until it is. Mirrors the server
// gate in mark-billed and the PO gate on Ready to Export.
function needsPo(t: ServiceBillingTicket): boolean {
  return !!t.customers?.po_required && !t.po_number
}

// Warranty work isn't billed until the vendor credit lands (logged on the
// warranty-claims worklist). Mirrors the server gate in mark-billed.
function awaitingWarrantyCredit(t: ServiceBillingTicket): boolean {
  return (
    (t.billing_type === 'warranty' || t.billing_type === 'partial_warranty') &&
    !t.warranty_credit_received_at
  )
}

function isBlocked(t: ServiceBillingTicket): boolean {
  return needsInvoice(t) || needsPo(t) || awaitingWarrantyCredit(t)
}

type ServiceInvoiceSortKey =
  | 'customer'
  | 'invoice'
  | 'poStatus'
  | 'synergy'
  | 'equipment'
  | 'technician'
  | 'billing'
  | 'ticketType'
  | 'type'
  | 'completed'

const SERVICE_INVOICE_SORT_ACCESSORS: SortAccessors<ServiceBillingTicket, ServiceInvoiceSortKey> = {
  customer: t => t.customers?.name,
  // Invoice-needed rows first (they block mark-billed).
  invoice: t => (needsInvoice(t) ? 0 : 1),
  // PO-needed rows first (they block mark-billed), then has-PO, then not-required.
  poStatus: t => (needsPo(t) ? 0 : t.customers?.po_required ? 1 : 2),
  synergy: t => t.synergy_order_number,
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

function shipToLabel(t: ServiceBillingTicket): string | null {
  const loc = t.equipment?.ship_to_locations
  return t.service_city || loc?.name || loc?.city || t.service_address || loc?.address || null
}

function customerSubline(t: ServiceBillingTicket): string | null {
  const acct = t.customers?.account_number
  const parts = [acct ? `Acct #${acct}` : null, shipToLabel(t)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export default function ServiceAwaitingInvoice({ tickets }: ServiceAwaitingInvoiceProps) {
  const router = useRouter()
  // Default to nothing selected so bulk mark-billed is an intentional opt-in (feedback #26).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [marking, setMarking] = useState(false)
  const [confirmingMarkBilled, setConfirmingMarkBilled] = useState(false)
  const [unexportingId, setUnexportingId] = useState<string | null>(null)
  // Un-export is one ticket at a time, but a coordinator once read a single
  // un-export as having sent a whole customer's tickets back (feedback #40). The
  // write was always scoped to one row — this is a perception guard: require a
  // confirm that names the specific WO# so it's unmistakable only that one
  // ticket moves.
  const [confirmingUnexportId, setConfirmingUnexportId] = useState<string | null>(null)
  const [notesCustomer, setNotesCustomer] = useState<{ id: number; name: string } | null>(null)
  // Rows with an inline editor (invoice #, Synergy order #, or PO #) open —
  // kept out of the "blocked" dim treatment below so a coordinator isn't
  // typing into a grayed-out row.
  const [editingRowIds, setEditingRowIds] = useState<Set<string>>(new Set())

  function setRowEditing(ticketId: string, editing: boolean) {
    setEditingRowIds((prev) => {
      const next = new Set(prev)
      if (editing) next.add(ticketId)
      else next.delete(ticketId)
      return next
    })
  }

  const missingCount = tickets.filter(needsInvoice).length
  const poMissingCount = tickets.filter(needsPo).length

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    ServiceBillingTicket,
    ServiceInvoiceSortKey
  >(tickets, SERVICE_INVOICE_SORT_ACCESSORS)

  function toggleSelect(id: string) {
    const ticket = tickets.find((t) => t.id === id)
    if (ticket && isBlocked(ticket)) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    const selectable = tickets.filter((t) => !isBlocked(t))
    if (selected.size === selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map((t) => t.id)))
    }
  }

  // Shared onSave callbacks for the InlineEditCell instances below — same
  // PATCH endpoint, same error handling (toast + rethrow so the cell can show
  // its own fail tick and stay open) as before the extraction.
  async function saveInvoice(ticketId: string, value: string) {
    try {
      const res = await fetch(`/api/service-tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synergy_invoice_number: value }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Synergy invoice #.'
      setToast({ message, type: 'error' })
      throw err
    }
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
        onEditingChange={(editing) => setRowEditing(t.id, editing)}
      />
    )
  }

  async function handleMarkBilled() {
    if (selected.size === 0 || marking) return

    setMarking(true)
    setToast(null)

    try {
      const res = await fetch('/api/billing/service/mark-billed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: Array.from(selected) }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      setToast({
        message: `${selected.size} ticket(s) marked billed.`,
        type: 'success',
      })
      setSelected(new Set())
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark billed. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setMarking(false)
    }
  }

  function woLabel(ticketId: string): string {
    const t = tickets.find((x) => x.id === ticketId)
    return t?.work_order_number != null ? `WO#${t.work_order_number}` : 'This ticket'
  }

  async function handleUnexport(ticketId: string) {
    if (unexportingId) return
    setUnexportingId(ticketId)
    setConfirmingUnexportId(null)
    setToast(null)
    const label = woLabel(ticketId)
    try {
      const res = await fetch('/api/billing/service/unexport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: [ticketId] }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      setToast({
        message: `${label} sent back to Ready to Export — only this ticket was moved.`,
        type: 'success',
      })
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(ticketId)
        return next
      })
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to un-export. Please try again.'
      setToast({ message, type: 'error' })
    } finally {
      setUnexportingId(null)
    }
  }

  const selectedTotal = tickets
    .filter((t) => selected.has(t.id))
    .reduce((sum, t) => sum + (t.billing_amount ?? 0), 0)

  const selectableCount = tickets.filter((t) => !isBlocked(t)).length
  const awaitingCreditCount = tickets.filter(awaitingWarrantyCredit).length

  function renderInvoiceStatus(t: ServiceBillingTicket) {
    return (
      <InlineEditCell
        value={t.synergy_invoice_number}
        placeholder="Synergy Invoice #"
        onSave={(v) => saveInvoice(t.id, v)}
        emptyVariant="pill"
        emptyText="Synergy Invoice # Needed"
        valueClassName="text-green-700 dark:text-green-400"
        onEditingChange={(editing) => setRowEditing(t.id, editing)}
      />
    )
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
        onEditingChange={(editing) => setRowEditing(t.id, editing)}
      />
    )
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

  function renderUnexportButton(t: ServiceBillingTicket) {
    if (unexportingId === t.id) {
      return <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1">Sending back…</span>
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmingUnexportId(t.id) }}
        className="text-xs font-medium px-2 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
        title="Send back to Ready to Export (clears the invoice #)"
      >
        Un-export
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* Section header + action bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Awaiting Invoice #{tickets.length > 0 ? ` (${tickets.length})` : ''}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Exported service tickets. Enter the Synergy invoice # for each, then mark them billed.
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            {selected.size > 0 && (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selected.size} selected — ${selectedTotal.toFixed(2)}
              </span>
            )}
            <button
              onClick={() => setConfirmingMarkBilled(true)}
              disabled={selected.size === 0 || marking}
              className="w-full lg:w-auto px-4 py-1.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {marking ? 'Marking billed...' : 'Mark Billed'}
            </button>
          </div>
        </div>
      </div>

      {/* Missing invoice # banner */}
      {missingCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {missingCount} ticket{missingCount === 1 ? '' : 's'} need{missingCount === 1 ? 's' : ''} a Synergy invoice # before {missingCount === 1 ? 'it' : 'they'} can be marked billed.
        </div>
      )}

      {/* Waiting on PO banner — these were exported without a PO; record it here
          before billing. */}
      {poMissingCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {poMissingCount} ticket{poMissingCount === 1 ? '' : 's'} need{poMissingCount === 1 ? 's' : ''} a PO number before {poMissingCount === 1 ? 'it' : 'they'} can be marked billed.
        </div>
      )}

      {/* Awaiting warranty credit banner */}
      {awaitingCreditCount > 0 && (
        <div className="rounded-lg p-3 text-sm border bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
          {awaitingCreditCount} warranty ticket{awaitingCreditCount === 1 ? '' : 's'} {awaitingCreditCount === 1 ? 'is' : 'are'} waiting on the vendor credit — log it on the Warranty Claims worklist before billing.
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

      {/* List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No exported service tickets awaiting an invoice #.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((t) => {
                const blocked = isBlocked(t)
                return (
                  <div
                    key={t.id}
                    className={`px-4 py-3 ${blocked && !editingRowIds.has(t.id) ? 'opacity-60' : ''}`}
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
                          {renderEquipment(t)}
                        </p>
                        {t.equipment?.serial_number && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            S/N {t.equipment.serial_number}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t.work_order_number != null ? `WO#${t.work_order_number} · ` : ''}
                          Tech: {t.assigned_technician?.name ?? '—'} ·{' '}
                          {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <TicketTypeBadge type={t.ticket_type} />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {BILLING_TYPE_LABELS[t.billing_type] ?? t.billing_type}
                          </span>
                          {awaitingWarrantyCredit(t) && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Awaiting vendor credit
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Completed:{' '}
                          {formatDateShort(t.completed_at)}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>PO:</span>
                          {renderPoStatus(t)}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Synergy Order #:</span>
                          {renderSynergyCell(t)}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {renderInvoiceStatus(t)}
                          <div className="flex items-center gap-1">
                            {renderNotesButton(t)}
                            {renderUnexportButton(t)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
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
                    <SortHeader label="Synergy Invoice #" colKey="invoice" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Synergy Order #" colKey="synergy" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Billing" colKey="billing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Service Type" colKey="ticketType" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Type" colKey="type" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((t) => {
                    const blocked = isBlocked(t)
                    return (
                      <tr key={t.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${blocked && !editingRowIds.has(t.id) ? 'opacity-60' : ''}`}>
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
                        <td className="px-4 py-3">
                          {renderInvoiceStatus(t)}
                        </td>
                        <td className="px-4 py-3">
                          {renderSynergyCell(t)}
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
                          {awaitingWarrantyCredit(t) && (
                            <span className="block text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
                              Awaiting vendor credit
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {formatDateShort(t.completed_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            {renderNotesButton(t)}
                            {renderUnexportButton(t)}
                          </div>
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

      <ConfirmDialog
        open={confirmingUnexportId !== null}
        title="Un-export ticket"
        message={`Send ${confirmingUnexportId ? woLabel(confirmingUnexportId) : 'this ticket'} back to Ready to Export? This clears its Synergy invoice #.`}
        confirmLabel="Un-export"
        confirmVariant="danger"
        loading={unexportingId !== null}
        onConfirm={() => {
          if (confirmingUnexportId) handleUnexport(confirmingUnexportId)
        }}
        onCancel={() => setConfirmingUnexportId(null)}
      />

      <ConfirmDialog
        open={confirmingMarkBilled}
        title="Mark tickets billed"
        message={`Mark ${selected.size} ticket${selected.size === 1 ? '' : 's'} billed for a total of $${selectedTotal.toFixed(2)}?`}
        confirmLabel="Mark Billed"
        loading={marking}
        onConfirm={() => {
          setConfirmingMarkBilled(false)
          handleMarkBilled()
        }}
        onCancel={() => setConfirmingMarkBilled(false)}
      />
    </div>
  )
}
