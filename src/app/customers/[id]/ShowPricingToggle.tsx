'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InlineError from '@/components/ui/InlineError'

interface ShowPricingToggleProps {
  customerId: number
  showPricing: boolean
}

export default function ShowPricingToggle({ customerId, showPricing }: ShowPricingToggleProps) {
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
        body: JSON.stringify({ show_pricing_on_pm_pdf: !showPricing }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error ?? 'Could not update pricing setting.')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('ShowPricingToggle error:', err)
      setError('Could not update pricing setting.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Show pricing on PM work order PDF
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            When on, the customer copy of the completed PM PDF includes a priced
            line-item summary with a &ldquo;not a final invoice&rdquo; disclaimer.
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          disabled={loading}
          role="switch"
          aria-checked={showPricing}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-slate-500 ${
            showPricing ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              showPricing ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {error && <InlineError message={error} />}
    </div>
  )
}
