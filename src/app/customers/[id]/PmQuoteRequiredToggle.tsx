'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InlineError from '@/components/ui/InlineError'

interface PmQuoteRequiredToggleProps {
  customerId: number
  pmQuoteRequired: boolean
}

export default function PmQuoteRequiredToggle({
  customerId,
  pmQuoteRequired,
}: PmQuoteRequiredToggleProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pm_quote_required: !pmQuoteRequired }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error ?? 'Could not update the quote setting.')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('PmQuoteRequiredToggle error:', err)
      setError('Could not update the quote setting.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Require an accepted quote before PM work starts
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            For accounts that will not authorize scheduled maintenance without a written
            price. PM tickets show a Quote Needed badge and cannot be started until the
            customer accepts a quote. Assignment is still allowed. Staff can build a quote
            for any customer regardless of this setting.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={loading}
          role="switch"
          aria-checked={pmQuoteRequired}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500 ${
            pmQuoteRequired ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              pmQuoteRequired ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {error && <InlineError message={error} />}
    </div>
  )
}
