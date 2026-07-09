'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import InlineError from '@/components/ui/InlineError'

interface ActiveToggleProps {
  customerId: number
  isActive: boolean
}

export default function ActiveToggle({ customerId, isActive }: ActiveToggleProps) {
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
        body: JSON.stringify({ active: !isActive }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error ?? 'Could not update customer status.')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('ActiveToggle error:', err)
      setError('Could not update customer status.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
          isActive
            ? 'text-red-700 bg-red-50 border border-red-200 hover:bg-red-100'
            : 'text-green-700 bg-green-50 border border-green-200 hover:bg-green-100'
        }`}
      >
        {loading ? 'Updating...' : isActive ? 'Mark Inactive' : 'Mark Active'}
      </button>
      {error && <InlineError message={error} />}
    </div>
  )
}
