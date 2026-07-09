'use client'

import { useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import Modal from '@/components/ui/Modal'

export type StrandedTicket = {
  id: string
  work_order_number: number | null
  status: string
}

export type PropagationPayload = {
  oldCustomerId: number
  newCustomerId: number
  serviceTickets: StrandedTicket[]
  pmTickets: StrandedTicket[]
}

interface Props {
  equipmentId: string
  payload: PropagationPayload
  // Called after the user resolves the prompt (either choice) so the parent can
  // refresh the page.
  onClose: () => void
}

export default function PropagateBillToModal({ equipmentId, payload, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneMsg, setDoneMsg] = useState<string | null>(null)

  const total = payload.serviceTickets.length + payload.pmTickets.length

  async function updateAll() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/equipment/${equipmentId}/propagate-billto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_customer_id: payload.newCustomerId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to update work orders')
      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length : 0
      setDoneMsg(
        `Updated ${data?.updated ?? 0} work order${(data?.updated ?? 0) === 1 ? '' : 's'}.` +
          (skippedCount > 0 ? ` ${skippedCount} skipped.` : '')
      )
      // Brief pause so the manager sees the result, then close + refresh.
      window.setTimeout(onClose, 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update work orders')
      setSubmitting(false)
    }
  }

  const rows: Array<{ key: string; label: string; status: string }> = [
    ...payload.serviceTickets.map((t) => ({
      key: `s-${t.id}`,
      label: `Service WO-${t.work_order_number ?? '?'}`,
      status: t.status,
    })),
    ...payload.pmTickets.map((t) => ({
      key: `p-${t.id}`,
      label: `PM WO-${t.work_order_number ?? '?'}`,
      status: t.status,
    })),
  ]

  return (
    <Modal
      open
      onClose={onClose}
      sheet
      size="lg"
      dismissible={!submitting}
      title="Update open work orders?"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 min-h-[44px]"
          >
            Keep as-is
          </button>
          <button
            type="button"
            onClick={updateAll}
            disabled={submitting || !!doneMsg}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 min-h-[44px]"
          >
            {submitting ? 'Updating...' : `Update all ${total}`}
          </button>
        </>
      }
    >
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {total} open work order{total === 1 ? '' : 's'} on this equipment still bill the old
          account. Repoint {total === 1 ? 'it' : 'them'} to the new bill-to too?
        </p>
        <ul className="rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-medium text-gray-900 dark:text-white">{r.label}</span>
              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {r.status.replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Work orders already keyed in Synergy are not listed and are never changed.
        </p>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" /> {error}
          </p>
        )}
        {doneMsg && (
          <p className="text-sm text-green-700 dark:text-green-400 inline-flex items-center gap-1.5">
            <Check className="h-4 w-4" /> {doneMsg}
          </p>
        )}
      </div>
    </Modal>
  )
}
