'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'

interface Props {
  lead: TechLeadWithJoins | null
  onClose: () => void
  onDone: () => void
}

export default function LeadReviewModal({ lead, onClose, onDone }: Props) {
  const [mode, setMode] = useState<'choose' | 'reject'>('choose')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lead) {
      setMode('choose')
      setReason('')
      setError(null)
      setSubmitting(false)
    }
  }, [lead])

  if (!lead) return null

  async function post(payload: Record<string, unknown>) {
    if (!lead) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${lead.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to update lead.')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lead.')
      setSubmitting(false)
    }
  }

  async function handleApprove() {
    await post({ action: 'approve' })
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError('Enter a rejection reason.')
      return
    }
    await post({ action: 'reject', reason: reason.trim() })
  }

  const customerLabel = lead.customers?.name
    ? lead.customers.name
    : lead.customer_name_text
      ? `${lead.customer_name_text} (new customer — not yet in system)`
      : '—'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-lg mx-4 max-h-[95vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Review tech lead
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 text-sm">
          <Field label="Tech">{lead.submitter?.name ?? '—'}</Field>
          <Field label="Customer">{customerLabel}</Field>
          <Field label="Equipment">
            <p className="whitespace-pre-wrap break-words">{lead.equipment_description}</p>
          </Field>
          {lead.proposed_pm_frequency && (
            <Field label="Proposed frequency">{lead.proposed_pm_frequency}</Field>
          )}
          {lead.notes && (
            <Field label="Notes">
              <p className="whitespace-pre-wrap break-words">{lead.notes}</p>
            </Field>
          )}
        </div>

        {error && (
          <p className="px-5 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {mode === 'choose' ? (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode('reject')}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Approving…' : 'Approve'}
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
              Rejection reason (visible to the tech)
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Explain why this lead doesn't qualify..."
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode('choose')}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={submitting || !reason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >
                {submitting ? 'Rejecting…' : 'Reject lead'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
        {label}
      </p>
      <div className="text-gray-900 dark:text-white">{children}</div>
    </div>
  )
}
