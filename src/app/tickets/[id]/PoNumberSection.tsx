'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/Button'

interface PoNumberSectionProps {
  ticketId: string
  initialPoNumber: string | null
}

export default function PoNumberSection({ ticketId, initialPoNumber }: PoNumberSectionProps) {
  const router = useRouter()
  const [poNumber, setPoNumber] = useState(initialPoNumber ?? '')
  const [saved, setSaved] = useState(!!initialPoNumber)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_number: poNumber.trim() || null }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save PO number')
      }
      setSaved(!!poNumber.trim())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving PO number')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        Customer PO #
      </h2>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <input
            type="text"
            value={poNumber}
            onChange={e => { setPoNumber(e.target.value); setSaved(false) }}
            placeholder="Enter customer PO if known"
            className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div className="flex items-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="secondary"
            size="mobile"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
