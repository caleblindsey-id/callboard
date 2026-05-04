'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AutoApproveThresholdInputProps {
  customerId: number
  threshold: number
}

export default function AutoApproveThresholdInput({
  customerId,
  threshold,
}: AutoApproveThresholdInputProps) {
  const router = useRouter()
  const [value, setValue] = useState(String(threshold))
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    const parsed = parseFloat(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('Please enter a valid non-negative dollar amount.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_approve_threshold: parsed }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        alert(payload.error ?? 'Could not update auto-approve threshold.')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('AutoApproveThresholdInput error:', err)
      alert('Could not update auto-approve threshold.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          Auto-approve threshold
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Estimates under this amount are automatically approved. Set to $0 to require
          approval on all estimates.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
          <span className="px-2 text-sm text-gray-500 dark:text-gray-400 select-none">$</span>
          <input
            type="number"
            min="0"
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 py-1 pr-2 text-sm text-gray-900 dark:text-white bg-transparent focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
