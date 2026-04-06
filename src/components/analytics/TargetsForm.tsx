'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { ResolvedTarget } from '@/lib/db/analytics'

interface TargetsFormProps {
  techId: string | null
  techName: string
  currentTargets: ResolvedTarget[]
  periodType: 'weekly' | 'monthly'
  onClose: () => void
}

const metricFields = [
  { key: 'tickets_completed', label: 'Tickets per period', placeholder: '15' },
  { key: 'revenue', label: 'Revenue per period ($)', placeholder: '4000' },
  { key: 'avg_completion_days', label: 'Avg completion (days)', placeholder: '2' },
  { key: 'revenue_per_hour', label: 'Revenue per hour ($)', placeholder: '120' },
]

export default function TargetsForm({ techId, techName, currentTargets, periodType, onClose }: TargetsFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const field of metricFields) {
      const existing = currentTargets.find((t) => t.metric === field.key)
      init[field.key] = existing ? existing.targetValue.toString() : ''
    }
    return init
  })

  async function handleSave() {
    setSaving(true)
    try {
      const promises = metricFields
        .filter((f) => values[f.key] !== '')
        .map((f) =>
          fetch('/api/analytics/targets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              technicianId: techId,
              metric: f.key,
              value: parseFloat(values[f.key]),
              periodType,
            }),
          })
        )
      await Promise.all(promises)
      router.refresh()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg border border-gray-200 p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Set Targets</h3>
            <p className="text-sm text-gray-500">
              {techId ? techName : 'Team-wide defaults'} · {periodType}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {metricFields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
              <input
                type="number"
                step="any"
                min="0"
                placeholder={field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Leave blank to keep current target. New targets take effect immediately.
        </p>

        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Targets'}
          </button>
        </div>
      </div>
    </div>
  )
}
