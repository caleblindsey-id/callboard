'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'
import { BUSINESS_TIME_ZONE } from '@/lib/format'
import type { ReorderScopeType } from '@/types/reorder'

const SCOPE_OPTIONS: { value: ReorderScopeType; label: string; helper: string }[] = [
  { value: 'all', label: 'All items', helper: 'Every active, reorderable item in Warehouse 4.' },
  { value: 'below_rop', label: 'Below reorder point', helper: 'Only items currently at or below their reorder point.' },
  { value: 'zone', label: 'Zone / bin prefix', helper: 'A bin-location prefix, e.g. "E" or "E5".' },
  { value: 'vendor', label: 'Vendor', helper: 'A single vendor code.' },
]

// Pinned to the business timezone (not a bare new Date().toISOString() slice)
// so the default name's date can't drift a day off in UTC — same reasoning as
// lib/format.ts's formatDate.
function defaultWalkName(): string {
  const label = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: BUSINESS_TIME_ZONE,
  })
  return `Reorder walk — ${label}`
}

const inputClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500'
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

export default function NewWalkForm({ initialScope }: { initialScope?: ReorderScopeType }) {
  const router = useRouter()
  const validInitialScope = initialScope && SCOPE_OPTIONS.some((o) => o.value === initialScope)
    ? initialScope
    : 'all'

  const [scopeType, setScopeType] = useState<ReorderScopeType>(validInitialScope)
  const [name, setName] = useState(defaultWalkName)
  const [scopeValue, setScopeValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (scopeType === 'zone' && !scopeValue.trim()) {
      setError('Enter a bin/zone prefix.')
      return
    }
    if (scopeType === 'vendor' && !scopeValue.trim()) {
      setError('Enter a vendor code.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/purchasing/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scope_type: scopeType,
          ...(scopeType === 'zone' || scopeType === 'vendor' ? { scope_value: scopeValue.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Failed to create reorder walk')
        setLoading(false)
        return
      }
      router.push(`/purchasing/${data.id}`)
    } catch {
      setError('Failed to create reorder walk')
      setLoading(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/purchasing"
          className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Back to Purchasing"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">New Reorder Walk</h1>
      </div>

      {error && <InlineError message={error} />}

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-5"
      >
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Scope</label>
          <div className="space-y-2">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                  scopeType === opt.value
                    ? 'border-slate-500 bg-slate-50 dark:bg-slate-800/50 dark:border-slate-400'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <input
                  type="radio"
                  name="scope_type"
                  value={opt.value}
                  checked={scopeType === opt.value}
                  onChange={() => setScopeType(opt.value)}
                  className="mt-1 accent-slate-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900 dark:text-white">{opt.label}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.helper}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {scopeType === 'zone' && (
          <div>
            <label className={labelClass}>Bin / Zone Prefix</label>
            <input
              type="text"
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              placeholder="e.g. E or E5"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Matches every bin location starting with this prefix.
            </p>
          </div>
        )}

        {scopeType === 'vendor' && (
          <div>
            <label className={labelClass}>Vendor Code</label>
            <input
              type="text"
              inputMode="numeric"
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              placeholder="e.g. 1042"
              className={inputClass}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              The Synergy vendor code — every item preferred to this vendor.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/purchasing"
            className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] px-6 py-2.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors lg:min-h-0"
          >
            {loading ? 'Creating…' : 'Start Walk'}
          </button>
        </div>
      </form>
    </div>
  )
}
