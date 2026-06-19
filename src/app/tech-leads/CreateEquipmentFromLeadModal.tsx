'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { X } from 'lucide-react'
import type { BillingType, TechLeadFrequency } from '@/types/database'
import type { TechLeadWithJoins } from '@/lib/db/tech-leads'
import { bonusRateForInterval, bonusAmountForInterval, bonusSuffixForInterval } from '@/lib/tech-leads/pm-bonus'

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

// Bonus eligibility per interval lives in @/lib/tech-lead-bonus (mirrors the
// migration 094 trigger): 1/2/3 full, 6 half, 4 and 12 none.
const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Every month'    },
  { value: 2,  label: 'Every 2 months' },
  { value: 3,  label: 'Every 3 months' },
  { value: 4,  label: 'Every 4 months' },
  { value: 6,  label: 'Every 6 months' },
  { value: 12, label: 'Once a year'    },
]

const BILLING_TYPES: { value: BillingType; label: string }[] = [
  { value: 'flat_rate',           label: 'Flat Rate' },
  { value: 'time_and_materials',  label: 'Time & Materials' },
  { value: 'contract',            label: 'Contract' },
]

// Pull a clean flat-rate prefill out of the tech's free-text quote. Accepts
// things like "$150", "150.00", "$1,200 / visit" → "150" / "1200". Returns ''
// when the quote isn't a single clean dollar figure (e.g. "TBD", "ask Steven"),
// so the manager just types it. Currency symbol, commas, and a trailing unit
// suffix (/visit, ea, per month) are stripped; anything else disqualifies it.
function flatRateFromQuote(quote: string | null | undefined): string {
  if (!quote) return ''
  const cleaned = quote
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/\s*(\/|per\b|each\b|ea\b).*$/i, '')
    .trim()
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return ''
  const n = parseFloat(cleaned)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

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
  const [startingYear, setStartingYear] = useState<number>(now.getFullYear())
  const [billingType, setBillingType] = useState<BillingType>('flat_rate')
  const [flatRate, setFlatRate] = useState<string>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Near-miss serial warning returned by the API (HTTP 409 + near_duplicate).
  // Holding it lets the office confirm and re-submit past the soft block.
  const [nearDuplicate, setNearDuplicate] = useState<{
    id: string
    make: string | null
    model: string | null
    serial: string | null
  } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!lead) return
    setNeedsCustomer(!lead.customer_id)
    setCustomerId(lead.customer_id ?? null)
    setCustomerSearch('')
    setCustomerResults([])
    setComboOpen(false)
    // Structured fields (migration 073) win when present; fall back to the
    // legacy free-text equipment_description for pre-073 PM leads.
    const hasStructured = !!(lead.make || lead.model || lead.serial_number)
    setMake(lead.make ?? '')
    setModel(lead.model ?? '')
    setSerialNumber(lead.serial_number ?? '')
    setLocationOnSite(lead.location_on_site ?? '')
    setDescription(hasStructured ? '' : lead.equipment_description.slice(0, 200))
    setIntervalMonths(proposedToInterval(lead.proposed_pm_frequency))
    const today = new Date()
    setAnchorMonth(lead.proposed_start_month ?? today.getMonth() + 1)
    setStartingYear(lead.proposed_start_year ?? today.getFullYear())
    setBillingType('flat_rate')
    // Prefill the flat rate from the tech's quote when it's a clean number; the
    // manager can still edit. Non-numeric quotes ("TBD") leave the field blank.
    setFlatRate(flatRateFromQuote(lead.quoted_amount))
    setError(null)
    setNearDuplicate(null)
    setSubmitting(false)
    // Focus dialog so onKeyDown captures Escape.
    dialogRef.current?.focus()
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
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(customerSearch.trim())
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number')
        .or(safeOrRaw([
          { column: 'name', op: 'ilike', raw: `%${q}%` },
          { column: 'account_number', op: 'ilike', raw: `%${q}%` },
        ]))
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

  const isFlatRate = billingType === 'flat_rate'
  const bonusAmount = isFlatRate ? bonusAmountForInterval(intervalMonths, parseFloat(flatRate || '0')) : 0
  const intervalEarnsNothing = bonusRateForInterval(intervalMonths) === 0
  const willEarnBonus = bonusAmount > 0

  // `confirmNearDuplicate` re-submits past the near-miss serial warning once the
  // office has eyeballed the existing unit and confirmed it's genuinely distinct.
  async function handleSubmit(confirmNearDuplicate = false) {
    if (!lead) return
    setError(null)
    if (!confirmNearDuplicate) setNearDuplicate(null)

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

    try {
      // Single server-side call wraps link_customer + equipment insert +
      // pm_schedule insert + link_equipment with rollback on failure (see
      // /api/tech-leads/[id]/create-equipment-from-lead).
      const flatRateNum = billingType === 'flat_rate' ? parseFloat(flatRate) : null
      const res = await fetch(`/api/tech-leads/${lead.id}/create-equipment-from-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          make: make.trim() || null,
          model: model.trim() || null,
          serial_number: serialNumber.trim() || null,
          description: description.trim() || null,
          location_on_site: locationOnSite.trim() || null,
          interval_months: intervalMonths,
          anchor_month: anchorMonth,
          starting_year: startingYear,
          billing_type: billingType,
          flat_rate: flatRateNum,
          confirm_near_duplicate: confirmNearDuplicate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Near-miss serial: surface a confirmable warning instead of a dead-end error.
        if (data?.near_duplicate && data?.existing_id) {
          setNearDuplicate({
            id: data.existing_id as string,
            make: (data.existing_make as string | null) ?? null,
            model: (data.existing_model as string | null) ?? null,
            serial: (data.existing_serial as string | null) ?? null,
          })
          setSubmitting(false)
          return
        }
        throw new Error(data?.error || 'Failed to create equipment from lead.')
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create equipment from lead.')
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-equipment-from-lead-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !submitting) onClose()
      }}
    >
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 max-h-[95vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 id="create-equipment-from-lead-title" className="text-base font-semibold text-gray-900 dark:text-white">Create equipment from lead</h3>
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

          {nearDuplicate && (
            <div className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 space-y-2">
              <p>
                <strong>Possible duplicate.</strong> This customer already has a very similar active unit
                {nearDuplicate.make || nearDuplicate.model
                  ? ` — ${[nearDuplicate.make, nearDuplicate.model].filter(Boolean).join(' ')}`
                  : ''}
                {nearDuplicate.serial ? ` (serial ${nearDuplicate.serial})` : ''}. Check the serial number before
                creating a second record.
              </p>
              <div className="flex items-center gap-3">
                <a
                  href={`/equipment/${nearDuplicate.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-amber-900 dark:text-amber-200 hover:text-amber-700"
                >
                  View existing unit
                </a>
                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={submitting}
                  className="text-amber-900 dark:text-amber-200 underline hover:text-amber-700 disabled:opacity-50"
                >
                  It&apos;s a different unit — create anyway
                </button>
              </div>
            </div>
          )}

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
                      {o.label}{bonusSuffixForInterval(o.value)}
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
            {(lead.proposed_start_month != null || lead.proposed_start_year != null) && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tech proposed start: {lead.proposed_start_month != null ? MONTHS[lead.proposed_start_month - 1] : '—'}
                {lead.proposed_start_year != null ? ` ${lead.proposed_start_year}` : ''}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Starting year</label>
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={startingYear}
                  onChange={e => {
                    const parsed = parseInt(e.target.value, 10)
                    if (Number.isFinite(parsed)) setStartingYear(parsed)
                  }}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
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
                {lead.quoted_amount && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Tech quoted: <span className="font-medium text-gray-700 dark:text-gray-300">{lead.quoted_amount}</span>
                  </p>
                )}
              </div>
            </div>

            {intervalEarnsNothing && isFlatRate && (
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
                <strong>${bonusAmount.toFixed(2)}</strong> bonus
                {bonusRateForInterval(intervalMonths) === 0.5 ? ' (half rate for six-month PMs)' : ''}.
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
            onClick={() => handleSubmit()}
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
