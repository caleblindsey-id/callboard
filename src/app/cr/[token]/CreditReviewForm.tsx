'use client'

import { useState } from 'react'

interface CreditReviewFormProps {
  token: string
}

export default function CreditReviewForm({ token }: CreditReviewFormProps) {
  const [loading, setLoading] = useState<'release' | 'block' | null>(null)
  const [result, setResult] = useState<'released' | 'blocked' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [showBlock, setShowBlock] = useState(false)
  const [blockReason, setBlockReason] = useState('')

  async function submit(action: 'release' | 'block') {
    if (!name.trim()) {
      setError('Please enter your name first.')
      return
    }
    setLoading(action)
    setError(null)
    try {
      const res = await fetch(`/api/credit-review/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          decided_by_name: name.trim(),
          block_reason: action === 'block' ? blockReason.trim() || undefined : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      setResult(action === 'release' ? 'released' : 'blocked')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  if (result === 'released') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-green-200 dark:border-green-800 p-8 text-center">
        <div className="text-green-600 dark:text-green-400 text-4xl mb-3">✓</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Order Released</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Thank you — the service team can proceed with this work.
        </p>
      </div>
    )
  }

  if (result === 'blocked') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Order Blocked</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          We&apos;ve recorded your decision. The work is locked until a manager overrides it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          id="credit-review-error"
          role="alert"
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm"
        >
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <label htmlFor="reviewer-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Your name
        </label>
        <input
          id="reviewer-name"
          type="text"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Jane Smith, AR"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 mb-4"
        />

        {!showBlock ? (
          <div className="space-y-3">
            <button
              onClick={() => submit('release')}
              disabled={loading !== null || !name.trim()}
              aria-describedby={error ? 'credit-review-error' : undefined}
              className="w-full px-4 py-3 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === 'release' ? 'Submitting...' : 'Release — let this work proceed'}
            </button>
            <button
              onClick={() => setShowBlock(true)}
              disabled={loading !== null}
              className="w-full px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300 bg-white dark:bg-gray-700 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              Block this work
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="block-reason" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Reason for blocking (optional)
            </label>
            <textarea
              id="block-reason"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Account 90+ days past due"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => submit('block')}
                disabled={loading !== null || !name.trim()}
                aria-describedby={error ? 'credit-review-error' : undefined}
                className="flex-1 px-4 py-3 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading === 'block' ? 'Submitting...' : 'Confirm block'}
              </button>
              <button
                onClick={() => setShowBlock(false)}
                disabled={loading !== null}
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
