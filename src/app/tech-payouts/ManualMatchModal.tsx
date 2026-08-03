'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { EquipmentSaleTier } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import { EQUIPMENT_SALE_TIER_LIST } from '@/lib/tech-leads/bonus-tiers'
import Modal from '@/components/ui/Modal'

interface Props {
  lead: TechLeadWithJoins | null
  onClose: () => void
  onDone: () => void
}

// Manually attach a known Synergy sale order to an approved equipment-sale lead
// and earn it, without waiting for the nightly scan (feedback #74).
export default function ManualMatchModal({ lead, onClose, onDone }: Props) {
  const [orderNumber, setOrderNumber] = useState('')
  const [orderDate, setOrderDate] = useState('')
  const [orderTotal, setOrderTotal] = useState('')
  const [tier, setTier] = useState<EquipmentSaleTier | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!lead) return
    setOrderNumber('')
    setOrderDate('')
    setOrderTotal('')
    setTier(lead.proposed_equipment_tier ?? '')
    setError(null)
    setSubmitting(false)
  }, [lead])

  if (!lead) return null

  async function handleSubmit() {
    if (!lead) return
    if (!orderNumber.trim()) {
      setError('Enter the Synergy order number.')
      return
    }
    if (!orderDate) {
      setError('Enter the order date.')
      return
    }
    if (!tier) {
      setError('Pick the equipment tier.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tech-leads/${lead.id}/manual-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synergy_order_number: orderNumber.trim(),
          synergy_order_date: orderDate,
          synergy_order_total: orderTotal.trim() || null,
          tier,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed to match the sale.')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to match the sale.')
      setSubmitting(false)
    }
  }

  const selectedTierInfo = tier ? EQUIPMENT_SALE_TIER_LIST.find(t => t.value === tier) : null
  const customerLabel = lead.customers?.name ?? lead.customer_name_text ?? '—'

  return (
    <Modal open onClose={onClose} dismissible={!submitting} sheet size="md" ariaLabelledBy="manual-match-title">
      <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
        <h3 id="manual-match-title" className="text-base font-semibold text-gray-900 dark:text-white">
          Manually match a sale
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
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Attach a completed Synergy sale order to <strong>{customerLabel}</strong>&apos;s lead and
          lock in the bonus. Use this when the nightly scan hasn&apos;t surfaced the sale.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Synergy order # <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={orderNumber}
              onChange={e => setOrderNumber(e.target.value)}
              placeholder="e.g. 949635"
              autoComplete="off"
              className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Order date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={orderDate}
              onChange={e => setOrderDate(e.target.value)}
              className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Order total (optional)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={orderTotal}
            onChange={e => setOrderTotal(e.target.value)}
            placeholder="e.g. 4995.00"
            autoComplete="off"
            className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Equipment tier <span className="text-red-500">*</span>
          </label>
          <select
            value={tier}
            onChange={e => setTier(e.target.value as EquipmentSaleTier)}
            className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            <option value="">Select…</option>
            {EQUIPMENT_SALE_TIER_LIST.map(t => (
              <option key={t.value} value={t.value}>
                {t.label} — ${t.amount}
              </option>
            ))}
          </select>
          {lead.proposed_equipment_tier && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Tech&apos;s suggested tier pre-filled.
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
            disabled={submitting || !orderNumber.trim() || !orderDate || !tier}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Matching…' : 'Match & earn'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
