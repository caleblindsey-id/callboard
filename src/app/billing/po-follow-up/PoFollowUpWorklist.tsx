'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Phone, Mail, MessageSquare, MoreHorizontal } from 'lucide-react'
import type { BillingChaseRow, BillingChaseReason, BillingChaseTicketType } from '@/lib/db/billing-chase'
import ScrollableTable from '@/components/ScrollableTable'
import InlineEditCell from '../InlineEditCell'
import PoFollowUpDrawer from './PoFollowUpDrawer'
import { formatDateShort } from '@/lib/format'

interface PoFollowUpWorklistProps {
  tickets: BillingChaseRow[]
}

function ticketHref(t: BillingChaseRow): string {
  return t.ticketType === 'pm' ? `/tickets/${t.id}` : `/service/${t.id}`
}

function ticketPatchUrl(t: BillingChaseRow): string {
  return t.ticketType === 'pm' ? `/api/tickets/${t.id}` : `/api/service-tickets/${t.id}`
}

function TypeChip({ type }: { type: BillingChaseTicketType }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
        type === 'pm'
          ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
          : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
      }`}
    >
      {type === 'pm' ? 'PM' : 'Service'}
    </span>
  )
}

function ReasonChips({ reasons }: { reasons: BillingChaseReason[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.includes('not_entered') && (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Not entered
        </span>
      )}
      {reasons.includes('po_missing') && (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          PO needed
        </span>
      )}
      {reasons.includes('not_invoiced') && (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          Not invoiced
        </span>
      )}
    </div>
  )
}

function renderEquipment(t: BillingChaseRow): string {
  const make = t.equipment?.make ?? t.equipmentMake
  const model = t.equipment?.model ?? t.equipmentModel
  return [make, model].filter(Boolean).join(' ') || '—'
}

function customerSubline(t: BillingChaseRow): string | null {
  const acct = t.customers?.account_number
  return acct ? `Acct #${acct}` : null
}

// Whole days between now and the last contact. Rendered client-side, so "today"
// is the viewer's clock — fine for a recency nudge.
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86_400_000)
}

function MethodIcon({ method }: { method: string | null }) {
  const cls = 'h-3.5 w-3.5'
  if (method === 'call') return <Phone className={cls} />
  if (method === 'email') return <Mail className={cls} />
  if (method === 'text') return <MessageSquare className={cls} />
  if (method === 'other') return <MoreHorizontal className={cls} />
  return null
}

function methodLabel(method: string | null): string {
  if (!method) return ''
  return method.charAt(0).toUpperCase() + method.slice(1)
}

// Color the recency: never-contacted or stale (>=7d) is urgent (red), aging
// (3-6d) amber, recent (<3d) green.
function LastContact({ t }: { t: BillingChaseRow }) {
  const d = daysSince(t.poLastContactedAt)
  if (d === null) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
        Not contacted
      </span>
    )
  }
  const tone =
    d >= 7
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      : d >= 3
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
  const label = d === 0 ? 'Today' : d === 1 ? '1d ago' : `${d}d ago`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${tone}`}>
      <MethodIcon method={t.poLastMethod} />
      {label}
      {t.poLastMethod ? ` · ${methodLabel(t.poLastMethod)}` : ''}
    </span>
  )
}

export default function PoFollowUpWorklist({ tickets }: PoFollowUpWorklistProps) {
  const router = useRouter()
  const [drawerTicket, setDrawerTicket] = useState<BillingChaseRow | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Shared saver for the three inline-edit fields — same PATCH endpoint the
  // billing queues use, branched to the PM or service route by ticket type.
  async function saveField(
    t: BillingChaseRow,
    field: 'po_number' | 'synergy_order_number' | 'synergy_invoice_number',
    value: string
  ) {
    try {
      const res = await fetch(ticketPatchUrl(t), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(d.error ?? `Server error ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save.'
      setToast({ message, type: 'error' })
      throw err
    }
  }

  function renderSynergyOrderCell(t: BillingChaseRow) {
    const needed = t.reasons.includes('not_entered')
    return (
      <InlineEditCell
        value={t.synergyOrderNumber}
        placeholder="Synergy Order #"
        onSave={(v) => saveField(t, 'synergy_order_number', v)}
        emptyVariant={needed ? 'pill' : 'ghost'}
        emptyText={needed ? 'Not Entered' : '+ Synergy Order #'}
        valueClassName="text-green-700 dark:text-green-400"
      />
    )
  }

  function renderPoCell(t: BillingChaseRow) {
    if (!t.customers?.po_required) {
      return <span className="text-gray-400 dark:text-gray-600">—</span>
    }
    return (
      <InlineEditCell
        value={t.poNumber}
        placeholder="PO #"
        onSave={(v) => saveField(t, 'po_number', v)}
        emptyVariant="pill"
        emptyText="PO Needed"
        valueClassName="text-green-700 dark:text-green-400"
        inputWidthClassName="w-24"
        valueMaxWidthClassName="max-w-[120px]"
        readOnlyWhenSet
      />
    )
  }

  function renderInvoiceCell(t: BillingChaseRow) {
    if (!t.billingExported) {
      return <span className="text-gray-400 dark:text-gray-600">—</span>
    }
    return (
      <InlineEditCell
        value={t.synergyInvoiceNumber}
        placeholder="Synergy Invoice #"
        onSave={(v) => saveField(t, 'synergy_invoice_number', v)}
        emptyVariant="pill"
        emptyText="Invoice Needed"
        valueClassName="text-green-700 dark:text-green-400"
      />
    )
  }

  function renderLogButton(t: BillingChaseRow) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setDrawerTicket(t) }}
        className="text-xs font-medium px-2.5 py-1 rounded-md text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors"
      >
        Log / History
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Billing Chase{tickets.length > 0 ? ` (${tickets.length})` : ''}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Completed PM and service jobs missing a Synergy order #, a required customer PO, or a Synergy invoice #. Log each contact attempt and enter the missing field to clear the job. Most-blocked, then oldest-completed first.
        </p>
      </div>

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

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Nothing to chase. Every completed job has its Synergy order, PO, and invoice # on file.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {tickets.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <TypeChip type={t.ticketType} />
                        <Link href={ticketHref(t)} className="text-sm font-medium text-gray-900 dark:text-white hover:underline">
                          {t.customers?.name ?? '—'}
                        </Link>
                      </div>
                      {customerSubline(t) && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{customerSubline(t)}</p>
                      )}
                      <p className="text-sm text-gray-600 dark:text-gray-400">{renderEquipment(t)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t.workOrderNumber != null ? `WO#${t.workOrderNumber} · ` : ''}
                        Tech: {t.assignedTechnician?.name ?? '—'} ·{' '}
                        {t.billingAmount != null ? `$${t.billingAmount.toFixed(2)}` : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Completed: {formatDateShort(t.completedAt)}
                      </p>
                      <div className="mt-1"><ReasonChips reasons={t.reasons} /></div>
                    </div>
                    <LastContact t={t} />
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0">Synergy Order:</span>
                      {renderSynergyOrderCell(t)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0">PO:</span>
                      {renderPoCell(t)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0">Invoice:</span>
                      {renderInvoiceCell(t)}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {renderLogButton(t)}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <ScrollableTable className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-left">
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Customer</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Type</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Technician</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Billing</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Completed</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Reasons</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Synergy Order #</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">PO</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Invoice #</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last Contact</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        <Link href={ticketHref(t)} className="hover:underline">
                          {t.customers?.name ?? '—'}
                        </Link>
                        {customerSubline(t) && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{customerSubline(t)}</span>
                        )}
                        {t.workOrderNumber != null && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">WO#{t.workOrderNumber}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <TypeChip type={t.ticketType} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {renderEquipment(t)}
                        {t.equipment?.serial_number && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">S/N {t.equipment.serial_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.assignedTechnician?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                        {t.billingAmount != null ? `$${t.billingAmount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {formatDateShort(t.completedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <ReasonChips reasons={t.reasons} />
                      </td>
                      <td className="px-4 py-3">
                        {renderSynergyOrderCell(t)}
                      </td>
                      <td className="px-4 py-3">
                        {renderPoCell(t)}
                      </td>
                      <td className="px-4 py-3">
                        {renderInvoiceCell(t)}
                      </td>
                      <td className="px-4 py-3">
                        <LastContact t={t} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {renderLogButton(t)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Looking for the billing queues?{' '}
        <Link href="/billing" className="underline hover:text-gray-600 dark:hover:text-gray-300">Back to Billing</Link>
      </p>

      <PoFollowUpDrawer
        ticketId={drawerTicket?.id ?? null}
        ticketType={drawerTicket?.ticketType ?? 'service'}
        title={drawerTicket ? (drawerTicket.customers?.name ?? '—') : null}
        subtitle={
          drawerTicket
            ? [
                drawerTicket.workOrderNumber != null ? `WO#${drawerTicket.workOrderNumber}` : null,
                renderEquipment(drawerTicket),
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
        onClose={() => setDrawerTicket(null)}
        onLogged={() => router.refresh()}
      />
    </div>
  )
}
