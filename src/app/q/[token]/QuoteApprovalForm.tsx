'use client'

import { useState } from 'react'
import SignaturePad from '@/components/SignaturePad'

interface QuoteApprovalFormProps {
  token: string
  /** When the account has po_required, a PO is mandatory to accept. */
  poRequired: boolean
}

export default function QuoteApprovalForm({ token, poRequired }: QuoteApprovalFormProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<'accepted' | 'declined' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')
  const [poNumber, setPoNumber] = useState('')

  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  async function handleAccept() {
    if (!signatureImage || !signatureName.trim()) {
      setError('Please sign and enter your name to accept.')
      return
    }
    // Mirrored server-side; this is only to save the customer a round trip.
    if (poRequired && !poNumber.trim()) {
      setError('A PO number is required on your account. Please enter one to accept this quote.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quote-approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          signature: signatureImage,
          signature_name: signatureName.trim(),
          po_number: poNumber.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to accept the quote')
      setResult('accepted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleDecline() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quote-approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'decline',
          decline_reason: declineReason.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to decline the quote')
      setResult('declined')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (result === 'accepted') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-green-200 dark:border-green-800 p-8 text-center">
        <div className="text-green-600 dark:text-green-400 text-4xl mb-3">✓</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Quote Accepted</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Thank you. Our service team will schedule the maintenance and reference your PO on
          the invoice.
        </p>
      </div>
    )
  }

  if (result === 'declined') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Quote Declined</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          We have recorded your response. A member of our team will follow up with you.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Accept Quote</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          By signing below, you authorize Imperial Dade to perform the scheduled preventative
          maintenance listed above at the quoted price. Any repair need found during the visit
          is quoted separately and is not performed without your approval.
        </p>

        <SignaturePad
          onSignatureChange={({ image, name }) => {
            setSignatureImage(image)
            setSignatureName(name)
          }}
        />

        <label
          htmlFor="quote-po-number"
          className="block text-xs text-gray-500 dark:text-gray-400 mt-4 mb-1"
        >
          PO number {poRequired ? '(required)' : '(optional)'}
        </label>
        <input
          id="quote-po-number"
          type="text"
          value={poNumber}
          onChange={(e) => setPoNumber(e.target.value)}
          placeholder={poRequired ? 'Required on your account' : 'If your company uses one'}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
        />

        <button
          type="button"
          onClick={handleAccept}
          disabled={loading}
          className="mt-4 w-full px-4 py-3 text-sm font-semibold text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Submitting...' : 'Accept Quote'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        {!showDecline ? (
          <button
            type="button"
            onClick={() => setShowDecline(true)}
            className="text-sm text-gray-600 dark:text-gray-300 underline hover:text-gray-900 dark:hover:text-white"
          >
            I do not want to proceed
          </button>
        ) : (
          <>
            <label
              htmlFor="quote-decline-reason"
              className="block text-sm font-semibold text-gray-900 dark:text-white mb-2"
            >
              Let us know why (optional)
            </label>
            <textarea
              id="quote-decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <button
              type="button"
              onClick={handleDecline}
              disabled={loading}
              className="mt-3 w-full px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Submitting...' : 'Decline Quote'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
