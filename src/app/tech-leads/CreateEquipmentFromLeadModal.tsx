'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { X } from 'lucide-react'
import type { BillingType, TechLeadFrequency } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
}

interface Props {
  lead: TechLeadWithJoins | null
  onClose: () => void
  onDone: () => void
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Every month',      eligible: true  },
  { value: 2,  label: 'Every 2 months',   eligible: true  },
  { value: 3,  label: 'Every 3 months',   eligible: true  },
  { value: 4,  label: 'Every 4 months',   eligible: false },
  { value: 6,  label: 'Every 6 months',   eligible: false },
  { value: 12, label: 'Once a year',      eligible: false },
]

const BILLING_TYPES: { value: BillingType; label: string }[] = [
  { value: 'flat_rate',           label: 'Flat Rate' },
  { value: 'time_and_materials',  label: 'Time & Materials' },
  { value: 'contract',            label: 'Contract' },
]

// Map tech's proposed frequency → default interval_months. Lets the manager
// flow start with a reasonable default without re-entering.
function proposedToInterval(freq: TechLeadFrequency | null): number {
  switch (freq) {
    case 'monthly':     return 1
    case 'bi-monthly':  return 2
    case 'quarterly':   return 3
    case 'semi-annual': return 6
    case 'annual':      return 12
    default:            return 3
  }
}

export default function CreateEquipmentFromLeadModal({ lead, onClose, onDone }: Props) {
  const [needsCustomer, setNeedsCustomer] = useState(false)

  // Customer picker (only when lead.customer_id is null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  // Equipment fields
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [description, setDescription] = useState('')
  const [locationOnSite, setLocationOnSite] = useState('')

  // Schedule fields
  const now = new Date()
  const [intervalMonths, setIntervalMonths] = useState<number>(3)
  const [anchorMonth, setAnchorMonth] = useState<number>(now.getMonth() + 1)
  const [billingType, setBillingType] = useState<BillingType>('flat_rate')
  const [flatRate, setFlatRate] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!lead) return
    setNeedsCustomer(!lead.customer_id)
    setCustomerId(lead.customer_id ?? null)
    setCustomerSearch('')
    setCustomerResults([])
    setComboOpen(false)
    setMake('')
    setModel('')
    setSerialNumber('')
    setDescription(lead.equipment_description.slice(0, 200)) // pre-fill from the tech's description
    setLocationOnSite('')
    setIntervalMonths(proposedToInterval(lead.proposed_pm_frequency))
    setAnchorMonth(new Date().getMonth() + 1)
    setBillingType('flat_rate')
    setFlatRate('')
    setError(null)
    setSubmitting(false)
  }, [lead])

  // Customer search (only when needed)
  useEffect(() => {
    if (!needsCustomer || !customerSearch.trim()) {
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
  }, [customerSearch, needsCustomer])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  if (!lead) return null

  function pickCustomer(c: CustomerOption) {
    setCustomerId(c.id)
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  const selectedInterval = INTERVAL_OPTIONS.find(o => o.value === intervalMonths)
  const willEarnBonus = selectedInterval?.eligible && billingType === 'flat_rate' && parseFloat(flatRate || '0') > 0

  async function handleSubmit() {
    if (!lead) return
    setError(null)

    if (!customerId) {
      setError('Pick the customer this equipment belongs to.')
      return
    }
    if (!make.trim() && !model.trim()) {
      setError('Enter at least a make or model.')
      return
    }
    if (billingType === 'flat_rate' && (!flatRate || parseFloat(flatRate) <= 0)) {
      setError('Flat rate PMs need a flat rate amount greater than zero.')
      return
    }

    setSubmitting(true)
    const supabase = createClient()

    try {
      // Step 1: link_customer first if the lead was submitted as free-text
      if (!lead.customer_id) {
        const linkRes = await fetch(`/api/tech-leads/${lead.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'link_customer', customer_id: customerId }),
        })
        const linkBody = await linkRes.json().catch(() => ({}))
        if (!linkRes.ok) throw new Error(linkBody?.error || 'Failed to link customer.')
      }

      // Step 2: insert equipment
      const { data: equipmentRow, error: eqErr } = await supabase
        .from('equipment')
        .insert({
          customer_id: customerId,
          make: make.trim() || null,
          model: model.trim() || null,
          serial_number: serialNumber.trim() || null,
          description: description.trim() || null,
          location_on_site: locationOnSite.trim() || null,
          active: true,
        })
        .select('id')
        .single()
      if (eqErr || !equipmentRow) {
        throw new Error(eqErr?.message || 'Failed to create equipment.')
      }

      // Step 3: insert pm_schedule
      const flatRateNum = billingType === 'flat_rate' ? parseFloat(flatRate) : null
      const { error: schedErr } = await supabase
        .from('pm_schedules')
        .insert({
          equipment_id: equipmentRow.id,
          interval_months: intervalMonths,
          anchor_month: anchorMonth,
          billing_type: billingType,
          flat_rate: flatRateNum,
          active: true,
        })
      if (schedErr) {
        throw new Error(schedErr.message || 'Failed to create PM schedule.')
      }

      // Step 4: link equipment back to the lead
      const linkEqRes = await fetch(`/api/tech-leads/${lead.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_equipment', equipment_id: equipmentRow.id }),
      })
      const linkEqBody = await linkEqRes.json().catch(() => ({}))
      if (!linkEqRes.ok) throw new Error(linkEqBody?.error || 'Failed to link equipment to lead.')

      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create equipment from lead.')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">Create equipment from lead</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Submitted by {lead.submitter?.name ?? '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400 p-1 -m-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Customer */}
          <div ref={comboRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            {needsCustomer ? (
              <>
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                  Tech submitted as a new customer: <strong>{lead.customer_name_text}</strong>. Pick the matching
                  Synergy customer record below. (If they haven&apos;t been created in Synergy yet, wait for the next
                  ERP sync and come back.)
                </p>
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
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                {searching && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>}
                {comboOpen && customerResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
                    {customerResults.map(c => (
                      <li
                        key={c.id}
                        onMouseDown={() => pickCustomer(c)}
                        className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 flex justify-between items-center gap-2"
                      >
                        <span className="text-gray-900 dark:text-white truncate">{c.name}</span>
                        {c.account_number && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">{c.account_number}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-900 dark:text-white py-2">
                {lead.customers?.name}
                {lead.customers?.account_number ? (
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    {lead.customers.account_number}
                  </span>
                ) : null}
              </p>
            )}
          </div>

          {/* Equipment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Make</label>
              <input
                type="text"
                value={make}
                onChange={e => setMake(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
              <input
                type="text"
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Serial #</label>
              <input
                type="text"
                value={serialNumber}
                onChange={e => setSerialNumber(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location on site</label>
              <input
                type="text"
                value={locationOnSite}
                onChange={e => setLocationOnSite(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">PM schedule</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Frequency</label>
                <select
                  value={intervalMonths}
                  onChange={e => setIntervalMonths(parseInt(e.target.value))}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  {INTERVAL_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}{!o.eligible ? ' — no bonus' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Anchor month</label>
                <select
                  value={anchorMonth}
                  onChange={e => setAnchorMonth(parseInt(e.target.value))}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Billing type</label>
                <select
                  value={billingType}
                  onChange={e => setBillingType(e.target.value as BillingType)}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                >
                  {BILLING_TYPES.map(b => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Flat rate {billingType === 'flat_rate' && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={flatRate}
                  onChange={e => setFlatRate(e.target.value)}
                  disabled={billingType !== 'flat_rate'}
                  placeholder="$0.00"
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
                />
              </div>
            </div>

            {selectedInterval && !selectedInterval.eligible && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                <strong>Heads up:</strong> this frequency is not eligible for a lead bonus. You can still save — the
                lead will stay Approved but will never earn. Use the Cancel action if the deal doesn&apos;t justify
                keeping it open.
              </p>
            )}
            {billingType !== 'flat_rate' && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                <strong>Heads up:</strong> lead bonuses pay only on flat-rate PMs. Time &amp; materials / contract PMs
                don&apos;t earn. You can still save the schedule if that&apos;s what the customer signed up for.
              </p>
            )}
            {willEarnBonus && (
              <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">
                When the first PM completes, {lead.submitter?.name ?? 'the tech'} will earn a{' '}
                <strong>${parseFloat(flatRate || '0').toFixed(2)}</strong> bonus.
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-gray-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create equipment'}
          </button>
        </div>
      </div>
    </div>
  )
}
