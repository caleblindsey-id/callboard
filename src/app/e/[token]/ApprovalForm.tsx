'use client'

import { useState } from 'react'
import SignaturePad from '@/components/SignaturePad'

interface ApprovalFormProps {
  token: string
}

export default function ApprovalForm({ token }: ApprovalFormProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<'approved' | 'declined' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [signatureImage, setSignatureImage] = useState<string | null>(null)
  const [signatureName, setSignatureName] = useState('')

  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  async function handleApprove() {
    if (!signatureImage || !signatureName.trim()) {
      setError('Please sign and enter your name to approve.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          signature: signatureImage,
          signature_name: signatureName.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to approve')
      setResult('approved')
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
      const res = await fetch(`/api/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'decline',
          decline_reason: declineReason.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to decline')
      setResult('declined')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (result === 'approved') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-green-200 dark:border-green-800 p-8 text-center">
        <div className="text-green-600 dark:text-green-400 text-4xl mb-3">✓</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Estimate Approved</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Thank you for approving this estimate. Our service team will be in touch
          to schedule the work.
        </p>
      </div>
    )
  }

  if (result === 'declined') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Estimate Declined</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          We&apos;ve recorded your response. A member of our team will follow up with you.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          id="approval-error"
          role="alert"
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          Approve Estimate
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          By signing below, you authorize Imperial Dade to perform the work described
          in this estimate at the quoted price. Actual charges may vary.
        </p>

        <SignaturePad
          onSignatureChange={({ image, name }) => {
            setSignatureImage(image)
            setSignatureName(name)
          }}
        />

        <button
          onClick={handleApprove}
          disabled={loading || !signatureImage || !signatureName.trim()}
          aria-describedby={error ? 'approval-error' : undefined}
          className="mt-4 w-full px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Submitting...' : 'Approve Estimate'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        {!showDecline ? (
          <button
            onClick={() => setShowDecline(true)}
            className="w-full text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium py-2 transition-colors"
          >
            Decline this estimate
          </button>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              Decline Estimate
            </h2>
            <label htmlFor="decline-reason" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Reason (optional)
            </label>
            <textarea
              id="decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3"
              placeholder="Reason for declining (optional)"
            />
            <div className="flex gap-2">
              <button
                onClick={handleDecline}
                disabled={loading}
                aria-describedby={error ? 'approval-error' : undefined}
                className="flex-1 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Submitting...' : 'Decline Estimate'}
              </button>
              <button
                onClick={() => setShowDecline(false)}
                className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
