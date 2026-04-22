'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { EquipmentSaleTier } from '@/types/database'
import type { CandidateWithLead } from '@/lib/db/equipment-sale-candidates'
import { EQUIPMENT_SALE_TIER_LIST } from '@/lib/tech-leads/bonus-tiers'

interface Props {
  candidate: CandidateWithLead | null
  proposedTier: EquipmentSaleTier | null
  onClose: () => void
  onDone: () => void
}

export default function ConfirmMatchModal({ candidate, proposedTier, onClose, onDone }: Props) {
  const [tier, setTier] = useState<EquipmentSaleTier | 'not_eligible' | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!candidate) return
    setTier(proposedTier ?? '')
    setError(null)
  }, [candidate, proposedTier])

  if (!candidate) return null

  async function handleSubmit() {
    if (!candidate) return
    if (!tier) {
      setError('Pick a tier or "Not eligible".')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      if (tier === 'not_eligible') {
        const res = await fetch(
          `/api/tech-leads/${candidate.tech_lead_id}/candidates/${candidate.id}/dismiss`,
          { method: 'POST' }
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Failed to dismiss candidate.')
      } else {
        const res = await fetch(
          `/api/tech-leads/${candidate.tech_lead_id}/candidates/${candidate.id}/confirm`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier }),
          }
        )
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error || 'Failed to confirm match.')
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to confirm match.')
      setSubmitting(false)
    }
  }

  const selectedTierInfo = tier !== 'not_eligible' && tier
    ? EQUIPMENT_SALE_TIER_LIST.find(t => t.value === tier)
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 sm:rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full sm:max-w-md sm:mx-4 rounded-t-xl">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Confirm match · Synergy #{candidate.synergy_order_number}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Equipment tier
            </label>
            <select
              value={tier}
              onChange={e => setTier(e.target.value as EquipmentSaleTier | 'not_eligible')}
              className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="">Select…</option>
              {EQUIPMENT_SALE_TIER_LIST.map(t => (
                <option key={t.value} value={t.value}>
                  {t.label} — ${t.amount}
                </option>
              ))}
              <option value="not_eligible">Not eligible (dismiss)</option>
            </select>
            {proposedTier && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Tech&apos;s suggested tier pre-filled.
              </p>
            )}
            {tier === 'cord_electric' && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Excludes vacuums, fans, and extractors under 10 gallon. If one of those is what they bought, pick &quot;Not eligible&quot;.
              </p>
            )}
            {tier === 'not_eligible' && (
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                This candidate will be dismissed. The lead stays open for the next candidate.
              </p>
            )}
            {selectedTierInfo && (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                Bonus will lock in at <strong>${selectedTierInfo.amount}</strong>.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !tier}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
            >
              {submitting
                ? 'Saving…'
                : tier === 'not_eligible' ? 'Dismiss candidate' : 'Confirm match'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
