'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TicketWithJoins } from '@/lib/db/tickets'
import ScrollableTable from '@/components/ScrollableTable'
import SortHeader from '@/components/SortHeader'
import { useSortableTable, type SortAccessors } from '@/lib/hooks/useSortableTable'

// PM tickets that have been exported to a billing PDF but are NOT yet billed.
// They become 'billed' only once a manager keys the SynergyERP invoice number
// (one invoice per work order) — the checks-and-balance that proves the work
// was actually invoiced in Synergy. Rendered as a section UNDER the PM
// "Ready to Export" list; the month picker on that list drives both queries, so
// this component intentionally has no picker of its own.

interface PmAwaitingInvoiceProps {
  tickets: TicketWithJoins[]
}

function needsInvoice(t: TicketWithJoins): boolean {
  return !t.synergy_invoice_number?.trim()
}

type PmInvoiceSortKey =
  | 'customer'
  | 'invoice'
  | 'equipment'
  | 'technician'
  | 'billing'
  | 'completed'

const PM_INVOICE_SORT_ACCESSORS: SortAccessors<TicketWithJoins, PmInvoiceSortKey> = {
  customer: t => t.customers?.name,
  // Invoice-needed rows first (they block mark-billed).
  invoice: t => (needsInvoice(t) ? 0 : 1),
  equipment: t => [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || null,
  technician: t => t.users?.name,
  billing: t => t.billing_amount,
  completed: t => t.completed_date,
}

// Compact ship-to label so identically-named machines can be told apart. The
// PM's snapshot ship-to first (set when a tech relocates equipment mid-PM),
// then the equipment's home ship-to.
function shipToLabel(t: TicketWithJoins): string | null {
  const loc = t.pm_ship_to ?? t.equipment?.ship_to_locations
  if (!loc) return null
  return loc.name || loc.city || loc.address || null
}

function customerSubline(t: TicketWithJoins): string | null {
  const acct = t.customers?.account_number
  const parts = [acct ? `Acct #${acct}` : null, shipToLabel(t)].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export default function PmAwaitingInvoice({ tickets }: PmAwaitingInvoiceProps) {
  const router = useRouter()
  // Default to nothing selected so bulk mark-billed is an intentional opt-in (feedback #26).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [marking, setMarking] = useState(false)
  const [unexportingId, setUnexportingId] = useState<string | null>(null)
  // Inline confirm naming the WO# so a single un-export can't be misread as a
  // bulk action — mirrors ServiceAwaitingInvoice (feedback #40).
  const [confirmingUnexportId, setConfirmingUnexportId] = useState<string | null>(null)

  // Inline Synergy invoice # editing — mirrors the PO editor on the PM
  // Ready-to-Export list.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [savingValue, setSavingValue] = useState(false)

  const missingCount = tickets.filter(needsInvoice).length

  const { sorted, sortKey, sortDir, toggleSort } = useSortableTable<
    TicketWithJoins,
    PmInvoiceSortKey
  >(tickets, PM_INVOICE_SORT_ACCESSORS)

  function toggleSelect(id: string) {
    const ticket = tickets.find((t) => t.id === id)
    if (ticket && needsInvoice(ticket)) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleAll() {
    const selectable = tickets.filter((t) => !needsInvoice(t))
    if (selected.size === selectable.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map((t) => t.id)))
    }
  }

  function startEdit(ticketId: string, current: string | null) {
    setEditingId(ticketId)
    setEditingValue(current ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingValue('')
  }

  async function handleSaveInvoice() {
    if (!editingId || savingValue) return
    const trimmed = editingValue.trim()
    if (!trimmed) return

    setSavingValue(true)
    try {
      const res = await fetch(`/api/tickets/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synergy_invoice_number: trimmed }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error ?? `Server error ${res.status}`)
      }

      setEditingId(null)
      setEditingValue('')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Synergy invoice #.'
      setToast({ message, type: 'error' })
    } finally {
      setSavingValue(false)
    }
  }

  async function handleMarkBilled() {
    if (selected.size === 0 || marking) return

    setMarking(true)
    setToast(null)

    try {
      const res = await fetch('/api/billing/mark-billed', {
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
      const res = await fetch('/api/billing/unexport', {
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

  const selectableCount = tickets.filter((t) => !needsInvoice(t)).length

  function renderInvoiceStatus(t: TicketWithJoins) {
    if (editingId === t.id) {
      return (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveInvoice()
              if (e.key === 'Escape') cancelEdit()
            }}
            placeholder="Invoice #"
            autoFocus
            disabled={savingValue}
            className="w-28 rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <button
            onClick={handleSaveInvoice}
            disabled={savingValue || !editingValue.trim()}
            className="px-1.5 py-0.5 text-xs font-medium text-white bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"
          >
            {savingValue ? '...' : 'Save'}
          </button>
          <button
            onClick={cancelEdit}
            disabled={savingValue}
            className="px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      )
    }
    if (t.synergy_invoice_number) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); startEdit(t.id, t.synergy_invoice_number) }}
          title={`${t.synergy_invoice_number} — click to edit`}
          className="text-green-700 dark:text-green-400 truncate max-w-[140px] inline-block align-bottom hover:underline"
        >
          {t.synergy_invoice_number}
        </button>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startEdit(t.id, null) }}
        className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
      >
        Invoice # Needed
      </button>
    )
  }

  function renderUnexportButton(t: TicketWithJoins) {
    if (unexportingId === t.id) {
      return <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1">Sending back…</span>
    }
    if (confirmingUnexportId === t.id) {
      const label = t.work_order_number != null ? `WO#${t.work_order_number}` : 'this ticket'
      return (
        <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-gray-600 dark:text-gray-400">Send {label} back?</span>
          <button
            onClick={() => handleUnexport(t.id)}
            className="text-xs font-medium px-2 py-1 rounded-md text-white bg-slate-700 hover:bg-slate-600 transition-colors"
            title="Send only this one ticket back to Ready to Export (clears its invoice #)"
          >
            Just this one
          </button>
          <button
            onClick={() => setConfirmingUnexportId(null)}
            className="text-xs px-1.5 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </span>
      )
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
              Exported PM tickets. Enter the Synergy invoice # for each, then mark them billed.
            </p>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
            {selected.size > 0 && (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {selected.size} selected — ${selectedTotal.toFixed(2)}
              </span>
            )}
            <button
              onClick={handleMarkBilled}
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
            No exported PM tickets awaiting an invoice #.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((t) => {
                const blocked = needsInvoice(t)
                return (
                  <div
                    key={t.id}
                    className={`px-4 py-3 ${blocked && editingId !== t.id ? 'opacity-60' : ''}`}
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
                          {[t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || '—'}
                        </p>
                        {t.equipment?.serial_number && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            S/N {t.equipment.serial_number}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {t.work_order_number != null ? `WO#${t.work_order_number} · ` : ''}
                          Tech: {t.users?.name ?? '—'} ·{' '}
                          {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Completed:{' '}
                          {t.completed_date
                            ? new Date(t.completed_date).toLocaleDateString()
                            : '—'}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {renderInvoiceStatus(t)}
                          {renderUnexportButton(t)}
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
                    <SortHeader label="Invoice #" colKey="invoice" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Equipment" colKey="equipment" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Technician" colKey="technician" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Billing" colKey="billing" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Completed" colKey="completed" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sorted.map((t) => {
                    const blocked = needsInvoice(t)
                    return (
                      <tr key={t.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${blocked && editingId !== t.id ? 'opacity-60' : ''}`}>
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
                          {renderInvoiceStatus(t)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {[t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || '—'}
                          {t.equipment?.serial_number && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                              S/N {t.equipment.serial_number}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                          {t.users?.name ?? '—'}
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
                        <td className="px-4 py-3 text-right">
                          {renderUnexportButton(t)}
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
    </div>
  )
}
