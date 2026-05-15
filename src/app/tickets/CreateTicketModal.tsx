'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { EquipmentRow, UserRow } from '@/types/database'
import { X } from 'lucide-react'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import DraftRestoredToast from '@/components/DraftRestoredToast'
import { useFormDraft } from '@/lib/hooks/useFormDraft'

const DRAFT_KEY = 'draft-create-pm-ticket'

interface CreateTicketDraft {
  customerId: string
  selectedCustomerName: string
  customerSearch: string
  equipmentId: string
  month: number
  year: number
  technicianId: string
  scheduledDate: string
  laborRateType: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
  credit_hold: boolean
}

interface CreateTicketModalProps {
  open: boolean
  onClose: () => void
}

export default function CreateTicketModal({ open, onClose }: CreateTicketModalProps) {
  const router = useRouter()
  const now = new Date()

  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [equipmentLoaded, setEquipmentLoaded] = useState(false)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Customer combobox state
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState('')
  const [selectedCustomerName, setSelectedCustomerName] = useState('')
  const [selectedCustomerCreditHold, setSelectedCustomerCreditHold] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  const [equipmentId, setEquipmentId] = useState('')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [technicianId, setTechnicianId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [laborRateType, setLaborRateType] = useState('standard')

  // Draft persistence — survives modal close + browser refresh.
  const draftState = useMemo<CreateTicketDraft>(() => ({
    customerId,
    selectedCustomerName,
    customerSearch,
    equipmentId,
    month,
    year,
    technicianId,
    scheduledDate,
    laborRateType,
  }), [customerId, selectedCustomerName, customerSearch, equipmentId, month, year, technicianId, scheduledDate, laborRateType])

  const { restoredAt, dismissRestoredToast, clearDraft, discardDraft } = useFormDraft<CreateTicketDraft>({
    key: DRAFT_KEY,
    state: draftState,
    enabled: open,
    isMeaningful: (s) =>
      Boolean(
        s.customerId ||
        s.equipmentId ||
        s.technicianId ||
        s.scheduledDate ||
        (s.customerSearch && s.customerSearch.trim() !== '') ||
        s.laborRateType !== 'standard'
      ),
    onRestore: (d) => {
      setCustomerId(d.customerId || '')
      setSelectedCustomerName(d.selectedCustomerName || '')
      setCustomerSearch(d.customerSearch || '')
      // Equipment is filtered server-side off `customerId`; the effect that
      // watches customerId will refetch the list and the value below will
      // resolve once `equipment` is populated. Storing the id alone is OK.
      setEquipmentId(d.equipmentId || '')
      if (typeof d.month === 'number') setMonth(d.month)
      if (typeof d.year === 'number') setYear(d.year)
      setTechnicianId(d.technicianId || '')
      setScheduledDate(d.scheduledDate || '')
      setLaborRateType(d.laborRateType || 'standard')
    },
  })

  // Load users when modal opens
  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase.from('users').select('*').eq('active', true).order('name').then(({ data }) => {
      if (data) setUsers(data)
    })
  }, [open])

  // Debounced customer search
  useEffect(() => {
    if (!customerSearch.trim()) {
      setCustomerResults([])
      setComboOpen(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or. Previously this
      // call site was missing sanitization entirely; a `,` or `(` in the search
      // box would have let the user inject extra clauses.
      const q = sanitizeOrValue(customerSearch.trim())
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number, credit_hold')
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
  }, [customerSearch])

  // Close combobox on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reload equipment when customer changes. We don't clobber `equipmentId`
  // up-front — instead we filter post-fetch so a restored draft can keep its
  // selection if the equipment is still valid for the chosen customer.
  useEffect(() => {
    setEquipment([])
    setEquipmentLoaded(false)
    if (!customerId) {
      setEquipmentId('')
      return
    }
    const supabase = createClient()
    supabase
      .from('equipment')
      .select('*')
      .eq('customer_id', parseInt(customerId))
      .eq('active', true)
      .order('make')
      .then(({ data }) => {
        const rows = (data ?? []) as EquipmentRow[]
        setEquipment(rows)
        setEquipmentLoaded(true)
        // Preserve current selection if still valid; otherwise clear.
        setEquipmentId((prev) => (prev && rows.some((e) => e.id === prev) ? prev : ''))
      })
  }, [customerId])

  function resetForm() {
    setCustomerSearch('')
    setCustomerId('')
    setSelectedCustomerName('')
    setSelectedCustomerCreditHold(false)
    setCustomerResults([])
    setComboOpen(false)
    setEquipmentId('')
    setEquipment([])
    setEquipmentLoaded(false)
    setMonth(new Date().getMonth() + 1)
    setYear(new Date().getFullYear())
    setTechnicianId('')
    setScheduledDate('')
    setError(null)
  }

  function handleClose() {
    // Cancel: keep draft intact so opening again restores progress. Just close
    // the modal — when it reopens, the hook re-mounts and restores from
    // localStorage. We deliberately do NOT call resetForm() here, because that
    // would briefly clobber the persisted draft on close.
    onClose()
  }

  function handleDiscardDraft() {
    discardDraft()
    resetForm()
  }

  function selectCustomer(c: CustomerOption) {
    setCustomerId(String(c.id))
    setSelectedCustomerName(c.name)
    setSelectedCustomerCreditHold(c.credit_hold)
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerId) {
      setError('Customer is required')
      return
    }
    setLoading(true)
    setError(null)

    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipment_id: equipmentId || undefined,
        customer_id: parseInt(customerId),
        month,
        year,
        assigned_technician_id: technicianId || undefined,
        scheduled_date: scheduledDate || undefined,
        labor_rate_type: laborRateType,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to create ticket')
      setLoading(false)
      return
    }

    setLoading(false)
    clearDraft()
    resetForm()
    onClose()
    router.refresh()
  }

  if (!open) return null

  const thisYear = now.getFullYear()
  const customerSelected = !!customerId
  const noEquipment = customerSelected && equipmentLoaded && equipment.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">New Ticket</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {restoredAt !== null && (
          <div className="mb-3">
            <DraftRestoredToast lastEditedAt={restoredAt} onDismiss={dismissRestoredToast} />
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Customer combobox */}
          <div ref={comboRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value)
                setCustomerId('')
                setSelectedCustomerName('')
              }}
              onFocus={() => { if (customerResults.length > 0) setComboOpen(true) }}
              placeholder="Search by name or account number..."
              autoComplete="off"
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            {searching && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>
            )}
            {comboOpen && customerResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-56 overflow-auto text-sm">
                {customerResults.map((c) => (
                  <li
                    key={c.id}
                    onMouseDown={() => selectCustomer(c)}
                    className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 flex justify-between items-center gap-2"
                  >
                    <span className="text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
                      <span className="truncate">{c.name}</span>
                      {c.credit_hold && <CreditHoldBadge />}
                    </span>
                    {c.account_number && (
                      <span className="text-gray-400 dark:text-gray-500 text-xs ml-2 shrink-0">{c.account_number}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {comboOpen && !searching && customerSearch.trim() && customerResults.length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No customers found.</p>
            )}
            {customerSelected && selectedCustomerCreditHold && (
              <div className="mt-2 bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-800 rounded-md px-3 py-2 flex items-center gap-2">
                <CreditHoldBadge />
                <span className="text-sm text-red-800 dark:text-red-300 font-semibold">
                  {selectedCustomerName} is on credit hold.
                </span>
              </div>
            )}
          </div>

          {/* Equipment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Equipment
            </label>
            {noEquipment ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic py-2">No equipment on file for this customer.</p>
            ) : (
              <select
                value={equipmentId}
                onChange={(e) => setEquipmentId(e.target.value)}
                disabled={!customerSelected}
                className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
              >
                <option value="">
                  {!customerSelected
                    ? 'Select a customer first'
                    : !equipmentLoaded
                    ? 'Loading equipment...'
                    : 'Select equipment...'}
                </option>
                {equipment.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {[eq.make, eq.model].filter(Boolean).join(' ') || eq.id}
                    {eq.serial_number ? ` — SN: ${eq.serial_number}` : ''}
                    {eq.location_on_site ? ` (${eq.location_on_site})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Month <span className="text-red-500">*</span>
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Year <span className="text-red-500">*</span>
              </label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Technician</label>
            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Scheduled Date</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Labor Rate
            </label>
            <select
              value={laborRateType}
              onChange={(e) => setLaborRateType(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <option value="standard">Standard</option>
              <option value="industrial">Industrial</option>
              <option value="vacuum">Vacuum</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline underline-offset-2"
            >
              Discard draft
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating...' : 'Create Ticket'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
