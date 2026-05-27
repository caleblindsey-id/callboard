'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, Flag, ShieldAlert } from 'lucide-react'
import CreditHoldBadge from '@/components/CreditHoldBadge'

interface CreditHoldCustomer {
  id: number
  name: string
  equipmentCount: number
}

interface PreviewResponse {
  preview: true
  wouldCreate: number
  wouldFlag: number
  skipped: number
  creditHoldCustomers: CreditHoldCustomer[]
}

interface GenerateResult {
  created: number
  pendingReview: number
  flagged: number
  creditReviewNotEmailed: number
}

interface GeneratePmModalProps {
  open: boolean
  month: number
  year: number
  monthLabel: string
  onClose: () => void
  onGenerated: (result: GenerateResult) => void
}

export default function GeneratePmModal({
  open,
  month,
  year,
  monthLabel,
  onClose,
  onGenerated,
}: GeneratePmModalProps) {
  const router = useRouter()
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setError(null)
      setResult(null)
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
      const res = await fetch('/api/tickets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate tickets')
        return
      }
      setResult({
        created: data.created ?? 0,
        pendingReview: data.pendingReview ?? 0,
        flagged: data.flagged ?? 0,
        creditReviewNotEmailed: data.creditReviewNotEmailed ?? 0,
      })
    } finally {
      setSubmitting(false)
    }
  }

  function handleDone() {
    if (result) onGenerated(result)
  }

  function handleViewFlagged() {
    if (result) onGenerated(result)
    router.push('/tickets?needsReview=1')
  }

  function handleViewCreditReview() {
    if (result) onGenerated(result)
    router.push('/credit-review')
  }

  if (!open) return null

  const netCreate = preview ? preview.wouldCreate : 0
  const creditHoldPmCount = preview
    ? preview.creditHoldCustomers.reduce((sum, c) => sum + c.equipmentCount, 0)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        {result ? (
          <>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {monthLabel} {year} PMs Generated
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  Created {result.created} ticket{result.created === 1 ? '' : 's'}.
                  {result.pendingReview > 0 && (
                    <> {result.pendingReview} sent to AR for credit review.</>
                  )}
                </p>
              </div>
            </div>
            {result.creditReviewNotEmailed > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-amber-800 dark:text-amber-300">
                    <p className="font-semibold">
                      {result.creditReviewNotEmailed} customer
                      {result.creditReviewNotEmailed === 1 ? '' : 's'} not emailed
                    </p>
                    <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                      Reviews were created but the AR email didn&apos;t send — check the AR email in
                      Settings, then resend from the credit review queue.
                    </p>
                  </div>
                </div>
              </div>
            )}
            {result.flagged > 0 && (
              <div className="mt-4 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
                <div className="flex items-start gap-2">
                  <Flag className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-sm text-blue-800 dark:text-blue-300">
                    <p className="font-semibold">{result.flagged} flagged for review</p>
                    <p className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-0.5">
                      A prior-month PM is still open for these tickets&apos; equipment. Review and approve or skip.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {result.pendingReview > 0 && (
                <button
                  type="button"
                  onClick={handleViewCreditReview}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-md hover:bg-amber-700"
                >
                  View credit review
                </button>
              )}
              {result.flagged > 0 && (
                <button
                  type="button"
                  onClick={handleViewFlagged}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  Review flagged
                </button>
              )}
              <button
                type="button"
                onClick={handleDone}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600"
              >
                Done
              </button>
            </div>
          </>
        ) : (
        <>
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
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Will create
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {netCreate}
                </p>
              </div>
              <div
                className={`rounded-md border p-3 ${
                  preview.creditHoldCustomers.length > 0
                    ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
                title="Credit-hold customers whose PMs will be created and sent to AR for credit review."
              >
                <p className={`text-xs uppercase tracking-wide ${
                  preview.creditHoldCustomers.length > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  Credit review
                </p>
                <p className={`mt-1 text-2xl font-semibold ${
                  preview.creditHoldCustomers.length > 0
                    ? 'text-amber-800 dark:text-amber-200'
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {preview.creditHoldCustomers.length}
                </p>
              </div>
              <div
                className={`rounded-md border p-3 ${
                  preview.wouldFlag > 0
                    ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
                title="Tickets whose equipment still has an open prior-month PM. Each will be flagged for manager review."
              >
                <p className={`text-xs uppercase tracking-wide ${
                  preview.wouldFlag > 0
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  Duplicates
                </p>
                <p className={`mt-1 text-2xl font-semibold ${
                  preview.wouldFlag > 0
                    ? 'text-blue-800 dark:text-blue-200'
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {preview.wouldFlag}
                </p>
              </div>
            </div>

            {preview.creditHoldCustomers.length > 0 && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {preview.creditHoldCustomers.length} customer
                    {preview.creditHoldCustomers.length === 1 ? '' : 's'} on credit hold · {creditHoldPmCount} PM
                    {creditHoldPmCount === 1 ? '' : 's'}
                  </p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                  These PMs <strong>will be created</strong> and automatically sent to AR for credit
                  approval. Work stays gated until AR releases each order — nothing is dropped.
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {preview.creditHoldCustomers.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between text-sm py-1 px-2 rounded"
                    >
                      <span className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                        <CreditHoldBadge />
                        {c.name}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {c.equipmentCount} PM{c.equipmentCount === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
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
        </>
        )}
      </div>
    </div>
  )
}
