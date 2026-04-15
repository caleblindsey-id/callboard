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
      <div className="bg-white rounded-xl shadow-sm border border-green-200 p-8 text-center">
        <div className="text-green-600 text-4xl mb-3">✓</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Estimate Approved</h2>
        <p className="text-sm text-gray-600">
          Thank you for approving this estimate. Our service team will be in touch
          to schedule the work.
        </p>
      </div>
    )
  }

  if (result === 'declined') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Estimate Declined</h2>
        <p className="text-sm text-gray-600">
          We&apos;ve recorded your response. A member of our team will follow up with you.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Approve Estimate
        </h2>
        <p className="text-xs text-gray-500 mb-4">
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
          className="mt-4 w-full px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Submitting...' : 'Approve Estimate'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {!showDecline ? (
          <button
            onClick={() => setShowDecline(true)}
            className="w-full text-sm text-red-600 hover:text-red-700 font-medium py-2 transition-colors"
          >
            Decline this estimate
          </button>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Decline Estimate
            </h2>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3"
              placeholder="Reason for declining (optional)"
            />
            <div className="flex gap-2">
              <button
                onClick={handleDecline}
                disabled={loading}
                className="flex-1 px-4 py-3 text-sm font-medium text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Submitting...' : 'Decline Estimate'}
              </button>
              <button
                onClick={() => setShowDecline(false)}
                className="px-4 py-3 text-sm text-gray-500 hover:text-gray-700 transition-colors"
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
