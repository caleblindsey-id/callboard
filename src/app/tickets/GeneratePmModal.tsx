'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import CreditHoldBadge from '@/components/CreditHoldBadge'

interface CreditHoldCustomer {
  id: number
  name: string
  equipmentCount: number
}

interface PreviewResponse {
  preview: true
  wouldCreate: number
  skipped: number
  creditHoldCustomers: CreditHoldCustomer[]
}

interface GeneratePmModalProps {
  open: boolean
  month: number
  year: number
  monthLabel: string
  onClose: () => void
  onGenerated: (result: { created: number; skippedCreditHold: number }) => void
}

export default function GeneratePmModal({
  open,
  month,
  year,
  monthLabel,
  onClose,
  onGenerated,
}: GeneratePmModalProps) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Credit-hold customers default to EXCLUDED (checkbox off = skip them).
  const [includeIds, setIncludeIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setIncludeIds(new Set())
      setError(null)
      return
    }
    let cancelled = false
    async function loadPreview() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/tickets/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, year, preview: true }),
        })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error ?? 'Failed to load preview')
          return
        }
        setPreview(data as PreviewResponse)
      } catch {
        if (!cancelled) setError('Failed to load preview')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [open, month, year])

  async function handleConfirm() {
    if (!preview) return
    setSubmitting(true)
    setError(null)
    try {
      const skipCreditHoldCustomerIds = preview.creditHoldCustomers
        .filter((c) => !includeIds.has(c.id))
        .map((c) => c.id)

      const res = await fetch('/api/tickets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          year,
          skipCreditHoldCustomerIds,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate tickets')
        return
      }
      onGenerated({
        created: data.created ?? 0,
        skippedCreditHold: data.skippedCreditHold ?? 0,
      })
    } finally {
      setSubmitting(false)
    }
  }

  function toggleInclude(id: number) {
    const next = new Set(includeIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setIncludeIds(next)
  }

  if (!open) return null

  const excludedCount = preview
    ? preview.creditHoldCustomers.reduce(
        (sum, c) => (includeIds.has(c.id) ? sum : sum + c.equipmentCount),
        0
      )
    : 0
  const netCreate = preview ? preview.wouldCreate - excludedCount : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Generate {monthLabel} {year} PMs
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Existing tickets for this month will not be duplicated.
            </p>
          </div>
        </div>

        {loading && (
          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">Loading preview…</p>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {preview && !loading && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Will create
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {netCreate}
                </p>
              </div>
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Credit hold customers
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {preview.creditHoldCustomers.length}
                </p>
              </div>
            </div>

            {preview.creditHoldCustomers.length > 0 && (
              <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CreditHoldBadge />
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    {preview.creditHoldCustomers.length} customer
                    {preview.creditHoldCustomers.length === 1 ? '' : 's'} on credit hold
                  </p>
                </div>
                <p className="text-xs text-red-700 dark:text-red-400 mb-3">
                  These customers are excluded by default. Check a box to generate PMs for them anyway.
                </p>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {preview.creditHoldCustomers.map((c) => {
                    const included = includeIds.has(c.id)
                    return (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 text-sm cursor-pointer py-1 px-2 rounded hover:bg-red-100/50 dark:hover:bg-red-900/30">
                          <input
                            type="checkbox"
                            checked={included}
                            onChange={() => toggleInclude(c.id)}
                            className="rounded border-gray-300 dark:border-gray-600 accent-slate-600"
                          />
                          <span
                            className={`flex-1 ${
                              included
                                ? 'text-gray-900 dark:text-white font-medium'
                                : 'text-gray-600 dark:text-gray-400 line-through'
                            }`}
                          >
                            {c.name}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-500">
                            {c.equipmentCount} PM{c.equipmentCount === 1 ? '' : 's'}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {netCreate === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No new tickets would be created.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || submitting || !preview || netCreate === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50"
          >
            {submitting ? 'Generating…' : `Generate ${netCreate}`}
          </button>
        </div>
      </div>
    </div>
  )
}
