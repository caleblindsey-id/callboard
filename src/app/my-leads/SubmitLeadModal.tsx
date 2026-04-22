'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { X } from 'lucide-react'
import type { EquipmentSaleTier, TechLeadFrequency, TechLeadType } from '@/types/database'
import { EQUIPMENT_SALE_TIER_LIST } from '@/lib/tech-leads/bonus-tiers'

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
}

interface SubmitLeadModalProps {
  open: boolean
  onClose: () => void
}

const FREQUENCIES: { value: TechLeadFrequency; label: string; eligible: boolean }[] = [
  { value: 'monthly', label: 'Monthly', eligible: true },
  { value: 'bi-monthly', label: 'Bi-monthly', eligible: true },
  { value: 'quarterly', label: 'Quarterly', eligible: true },
  { value: 'semi-annual', label: 'Semi-annual', eligible: false },
  { value: 'annual', label: 'Annual', eligible: false },
]

export default function SubmitLeadModal({ open, onClose }: SubmitLeadModalProps) {
  const router = useRouter()

  // Lead type toggle (new in V2)
  const [leadType, setLeadType] = useState<TechLeadType>('pm')

  // Customer selection
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [newCustomerMode, setNewCustomerMode] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const comboRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // PM lead fields
  const [equipmentDescription, setEquipmentDescription] = useState('')
  const [frequency, setFrequency] = useState<TechLeadFrequency | ''>('')

  // Equipment-sale lead fields
  const [equipmentTier, setEquipmentTier] = useState<EquipmentSaleTier | ''>('')

  // Shared
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the modal opens
  useEffect(() => {
    if (!open) return
    setLeadType('pm')
    setCustomerSearch('')
    setCustomerResults([])
    setCustomerId(null)
    setComboOpen(false)
    setNewCustomerMode(false)
    setNewCustomerName('')
    setEquipmentDescription('')
    setFrequency('')
    setEquipmentTier('')
    setNotes('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!customerSearch.trim() || newCustomerMode) {
      setCustomerResults([])
      setComboOpen(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      const q = customerSearch.trim()
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number')
        .or(`name.ilike.%${q}%,account_number.ilike.%${q}%`)
        .order('name')
        .limit(25)
      setCustomerResults((data as CustomerOption[]) ?? [])
      setComboOpen(true)
      setSearching(false)
    }, 300)
  }, [customerSearch, newCustomerMode])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function pickCustomer(c: CustomerOption) {
    setCustomerId(c.id)
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!newCustomerMode && !customerId) {
      setError('Pick an existing customer or tap "+ New customer".')
      return
    }
    if (newCustomerMode && !newCustomerName.trim()) {
      setError('Enter the new customer name.')
      return
    }

    let body: Record<string, unknown>
    if (leadType === 'pm') {
      if (!equipmentDescription.trim()) {
        setError('Describe the equipment.')
        return
      }
      body = {
        lead_type: 'pm',
        customer_id: newCustomerMode ? null : customerId,
        customer_name_text: newCustomerMode ? newCustomerName.trim() : null,
        equipment_description: equipmentDescription.trim(),
        proposed_pm_frequency: frequency || null,
        notes: notes.trim() || null,
      }
    } else {
      if (!equipmentTier) {
        setError('Pick the equipment tier.')
        return
      }
      body = {
        lead_type: 'equipment_sale',
        customer_id: newCustomerMode ? null : customerId,
        customer_name_text: newCustomerMode ? newCustomerName.trim() : null,
        proposed_equipment_tier: equipmentTier,
        notes: notes.trim() || null,
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/tech-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const respBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(respBody?.error || 'Failed to submit lead.')
      }
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit lead.')
      setSubmitting(false)
    }
  }

  if (!open) return null

  const selectedFreq = FREQUENCIES.find(f => f.value === frequency)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 sm:rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full sm:max-w-lg sm:mx-4 rounded-t-xl max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-5 py-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Submit a lead</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Lead type toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Lead type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLeadType('pm')}
                className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  leadType === 'pm'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                PM Lead
              </button>
              <button
                type="button"
                onClick={() => setLeadType('equipment_sale')}
                className={`min-h-[44px] rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  leadType === 'equipment_sale'
                    ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-700'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                }`}
              >
                Equipment Sale Lead
              </button>
            </div>
            {leadType === 'pm' ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Customer is adding equipment to a PM schedule. Bonus = first PM&apos;s flat rate (monthly, bi-monthly, or quarterly only).
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Customer has aging equipment you want replaced. Bonus pays when we sell a qualifying replacement within 90 days.
              </p>
            )}
          </div>

          {/* Customer */}
          <div ref={comboRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            {!newCustomerMode ? (
              <>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={e => {
                    setCustomerSearch(e.target.value)
                    setCustomerId(null)
                  }}
                  onFocus={() => { if (customerResults.length > 0) setComboOpen(true) }}
                  placeholder="Search by name or account number..."
                  autoComplete="off"
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                {searching && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>}
                {comboOpen && customerResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
                    {customerResults.map(c => (
                      <li
                        key={c.id}
                        onMouseDown={() => pickCustomer(c)}
                        className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 flex justify-between items-center gap-2 min-h-[44px]"
                      >
                        <span className="text-gray-900 dark:text-white truncate">{c.name}</span>
                        {c.account_number && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">{c.account_number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerMode(true)
                    setCustomerId(null)
                    setCustomerSearch('')
                    setComboOpen(false)
                  }}
                  className="mt-2 text-sm text-slate-600 dark:text-slate-300 hover:underline"
                >
                  + New customer (not in system)
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={newCustomerName}
                  onChange={e => setNewCustomerName(e.target.value)}
                  placeholder="New customer company name"
                  autoComplete="off"
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    setNewCustomerMode(false)
                    setNewCustomerName('')
                  }}
                  className="mt-2 text-sm text-slate-600 dark:text-slate-300 hover:underline"
                >
                  ← Pick existing customer
                </button>
              </>
            )}
          </div>

          {leadType === 'pm' ? (
            <>
              {/* Equipment description (PM only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Equipment <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={equipmentDescription}
                  onChange={e => setEquipmentDescription(e.target.value)}
                  rows={3}
                  placeholder="Make, model, serial #, location on site..."
                  className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Proposed PM frequency
                </label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as TechLeadFrequency)}
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">Not sure / leave to manager</option>
                  {FREQUENCIES.map(f => (
                    <option key={f.value} value={f.value}>
                      {f.label}{!f.eligible ? ' — no bonus' : ''}
                    </option>
                  ))}
                </select>
                {selectedFreq && !selectedFreq.eligible && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Semi-annual and annual PMs are not eligible for a lead bonus.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Equipment tier (Equipment sale only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Equipment tier <span className="text-red-500">*</span>
                </label>
                <select
                  value={equipmentTier}
                  onChange={e => setEquipmentTier(e.target.value as EquipmentSaleTier)}
                  className="w-full min-h-[44px] rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  <option value="">Select tier…</option>
                  {EQUIPMENT_SALE_TIER_LIST.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label} — ${t.amount}
                    </option>
                  ))}
                </select>
                {equipmentTier === 'cord_electric' && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Excludes vacuums, fans, and extractors under 10 gallon.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={leadType === 'equipment_sale'
                ? 'Make, model, serial #, location, condition…'
                : 'Anything the office should know...'}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
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
              type="submit"
              disabled={submitting}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 dark:hover:bg-slate-600 rounded-md disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
