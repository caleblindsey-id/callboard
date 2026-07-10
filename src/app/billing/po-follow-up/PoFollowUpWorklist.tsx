'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Phone, Mail, MessageSquare, MoreHorizontal } from 'lucide-react'
import type { PoFollowUpQueueTicket } from '@/lib/db/service-tickets'
import ScrollableTable from '@/components/ScrollableTable'
import PoFollowUpDrawer from './PoFollowUpDrawer'
import { formatDateShort } from '@/lib/format'

interface PoFollowUpWorklistProps {
  tickets: PoFollowUpQueueTicket[]
}

function renderEquipment(t: PoFollowUpQueueTicket): string {
  const make = t.equipment?.make ?? t.equipment_make
  const model = t.equipment?.model ?? t.equipment_model
  return [make, model].filter(Boolean).join(' ') || '—'
}

function customerSubline(t: PoFollowUpQueueTicket): string | null {
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
function LastContact({ t }: { t: PoFollowUpQueueTicket }) {
  const d = daysSince(t.po_last_contacted_at)
  if (d === null) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Never contacted
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
      <MethodIcon method={t.po_last_method} />
      {label}
      {t.po_last_method ? ` · ${methodLabel(t.po_last_method)}` : ''}
    </span>
  )
}

export default function PoFollowUpWorklist({ tickets }: PoFollowUpWorklistProps) {
  const router = useRouter()
  const [drawerTicket, setDrawerTicket] = useState<PoFollowUpQueueTicket | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Inline PO entry — recording the PO drops the ticket off this list and
  // unblocks billing. PATCHes the same route/field the billing queues use.
  const [editingPoId, setEditingPoId] = useState<string | null>(null)
  const [editingPoValue, setEditingPoValue] = useState('')
  const [savingPo, setSavingPo] = useState(false)

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
        const d = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(d.error ?? `Server error ${res.status}`)
      }
      setEditingPoId(null)
      setEditingPoValue('')
      setToast({ message: 'PO recorded — ticket cleared from the worklist.', type: 'success' })
      router.refresh()
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Failed to save PO.', type: 'error' })
    } finally {
      setSavingPo(false)
    }
  }

  function renderPoCell(t: PoFollowUpQueueTicket) {
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
        className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-800 text-white hover:bg-slate-700 transition-colors"
      >
        + Enter PO
      </button>
    )
  }

  function renderLogButton(t: PoFollowUpQueueTicket) {
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
          Waiting on PO{tickets.length > 0 ? ` (${tickets.length})` : ''}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Completed jobs for PO-required customers with no PO yet. Log each contact attempt, and enter the PO once you get it to clear the job for billing. Oldest-contacted first.
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
            No jobs waiting on a PO. Nice — nothing to chase.
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {tickets.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {t.customers?.name ?? '—'}
                      </p>
                      {customerSubline(t) && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{customerSubline(t)}</p>
                      )}
                      <p className="text-sm text-gray-600 dark:text-gray-400">{renderEquipment(t)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {t.work_order_number != null ? `WO#${t.work_order_number} · ` : ''}
                        Tech: {t.assigned_technician?.name ?? '—'} ·{' '}
                        {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Completed: {formatDateShort(t.completed_at)}
                      </p>
                    </div>
                    <LastContact t={t} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {renderPoCell(t)}
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
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Equipment</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Technician</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Billing</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Completed</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last Contact</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">PO</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">
                        {t.customers?.name ?? '—'}
                        {customerSubline(t) && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{customerSubline(t)}</span>
                        )}
                        {t.work_order_number != null && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">WO#{t.work_order_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {renderEquipment(t)}
                        {t.equipment?.serial_number && (
                          <span className="block text-xs text-gray-500 dark:text-gray-400">S/N {t.equipment.serial_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {t.assigned_technician?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white font-medium">
                        {t.billing_amount != null ? `$${t.billing_amount.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {formatDateShort(t.completed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <LastContact t={t} />
                      </td>
                      <td className="px-4 py-3">
                        {renderPoCell(t)}
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
        title={drawerTicket ? (drawerTicket.customers?.name ?? '—') : null}
        subtitle={
          drawerTicket
            ? [
                drawerTicket.work_order_number != null ? `WO#${drawerTicket.work_order_number}` : null,
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
