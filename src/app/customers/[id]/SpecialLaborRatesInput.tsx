'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type RateType = 'standard' | 'industrial' | 'vacuum'

const ROWS: { type: RateType; label: string }[] = [
  { type: 'standard', label: 'Standard' },
  { type: 'industrial', label: 'Industrial' },
  { type: 'vacuum', label: 'Vacuum' },
]

interface SpecialLaborRatesInputProps {
  customerId: number
  // Current per-customer overrides; null means "use global".
  rates: Record<RateType, number | null>
  // Global rates, shown as placeholders so staff know what blank falls back to.
  globals: Record<RateType, number>
}

export default function SpecialLaborRatesInput({
  customerId,
  rates,
  globals,
}: SpecialLaborRatesInputProps) {
  const router = useRouter()
  // 0 (and null) means "use global", so show it as an empty field.
  const initial = (r: number | null) => (r != null && r > 0 ? String(r) : '')
  const [values, setValues] = useState<Record<RateType, string>>({
    standard: initial(rates.standard),
    industrial: initial(rates.industrial),
    vacuum: initial(rates.vacuum),
  })
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    const payload: Record<string, number | null> = {}
    for (const { type } of ROWS) {
      const raw = values[type].trim()
      if (raw === '') {
        payload[`special_labor_rate_${type}`] = null
        continue
      }
      const parsed = parseFloat(raw)
      if (!Number.isFinite(parsed) || parsed < 0) {
        alert(`Please enter a valid non-negative rate, or leave the ${type} field blank to use the global rate.`)
        return
      }
      // 0 means "use global" — store null so the override is cleared.
      payload[`special_labor_rate_${type}`] = parsed > 0 ? parsed : null
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Could not update special labor rates.')
        return
      }
      router.refresh()
    } catch (err) {
      console.error('SpecialLaborRatesInput error:', err)
      alert('Could not update special labor rates.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            Special labor rates
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Negotiated or bid hourly rates for this customer. Leave a field blank (or 0)
            to use the global rate for that type.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {ROWS.map(({ type, label }) => (
          <div key={type} className="flex items-center justify-between gap-4">
            <label htmlFor={`special-rate-${type}`} className="text-sm text-gray-700 dark:text-gray-300">
              {label}
            </label>
            <div className="flex items-center rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 overflow-hidden">
              <span className="px-2 text-sm text-gray-500 dark:text-gray-400 select-none">$</span>
              <input
                id={`special-rate-${type}`}
                type="number"
                min="0"
                step="0.01"
                value={values[type]}
                placeholder={`Global: ${globals[type]}`}
                onChange={(e) => setValues((v) => ({ ...v, [type]: e.target.value }))}
                className="w-32 py-1 pr-2 text-sm text-gray-900 dark:text-white bg-transparent focus:outline-none"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
