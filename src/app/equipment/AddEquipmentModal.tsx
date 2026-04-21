'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { BillingType, DefaultProduct } from '@/types/database'
import { formatPhoneNumber } from '@/lib/phone'
import { normalizeSerial, serialsMatch } from '@/lib/equipment'
import { X, Plus, Minus, Trash2 } from 'lucide-react'

type DuplicateMatch = {
  id: string
  make: string | null
  model: string | null
}

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
}

interface TechnicianOption {
  id: string
  name: string
}

interface ProductSearchResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Every month' },
  { value: 2,  label: 'Every 2 months' },
  { value: 3,  label: 'Every 3 months' },
  { value: 4,  label: 'Every 4 months' },
  { value: 6,  label: 'Every 6 months' },
  { value: 12, label: 'Once a year' },
]

const BILLING_TYPES: { value: BillingType; label: string }[] = [
  { value: 'flat_rate', label: 'Flat Rate' },
  { value: 'time_and_materials', label: 'Time & Materials' },
  { value: 'contract', label: 'Contract' },
]

// Shared class strings for consistency
const inputClasses = "w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
const labelClasses = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"

interface AddEquipmentModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function AddEquipmentModal({
  open,
  onClose,
  onCreated,
}: AddEquipmentModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null)

  // Customer combobox state
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  // Ship-to location state
  const [shipToLocations, setShipToLocations] = useState<{id: number; name: string | null; city: string | null}[]>([])
  const [shipToLocationId, setShipToLocationId] = useState('')

  // Equipment fields
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [description, setDescription] = useState('')
  const [locationOnSite, setLocationOnSite] = useState('')

  // Contact
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  // Default technician
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([])
  const [defaultTechId, setDefaultTechId] = useState('')

  // Default Products
  const [defaultProducts, setDefaultProducts] = useState<DefaultProduct[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([])
  const [productComboOpen, setProductComboOpen] = useState(false)
  const [productSearching, setProductSearching] = useState(false)
  const productDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const productComboRef = useRef<HTMLDivElement>(null)

  // PM Schedule
  const [addSchedule, setAddSchedule] = useState(false)
  const [intervalMonths, setIntervalMonths] = useState(3)
  const [anchorMonth, setAnchorMonth] = useState(1)
  const [billingType, setBillingType] = useState<BillingType>('flat_rate')
  const [flatRate, setFlatRate] = useState('')

  // Fetch technicians on mount
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('users')
      .select('id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setTechnicians((data as TechnicianOption[]) ?? [])
      })
  }, [])

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

  // Load ship-to locations when customer changes
  useEffect(() => {
    setShipToLocationId('')
    setShipToLocations([])
    if (!customerId) return
    const supabase = createClient()
    supabase
      .from('ship_to_locations')
      .select('id, name, city')
      .eq('customer_id', parseInt(customerId))
      .order('name')
      .then(({ data }) => {
        setShipToLocations(data ?? [])
      })
  }, [customerId])

  // Debounced product search
  useEffect(() => {
    if (!productSearch.trim()) {
      setProductResults([])
      setProductComboOpen(false)
      return
    }
    if (productDebounceRef.current) clearTimeout(productDebounceRef.current)
    productDebounceRef.current = setTimeout(async () => {
      setProductSearching(true)
      const supabase = createClient()
      const q = productSearch.trim()
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description')
        .or(`number.ilike.%${q}%,description.ilike.%${q}%`)
        .order('number')
        .limit(25)
      setProductResults((data as ProductSearchResult[]) ?? [])
      setProductComboOpen(true)
      setProductSearching(false)
    }, 300)
  }, [productSearch])

  // Close product dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (productComboRef.current && !productComboRef.current.contains(e.target as Node)) {
        setProductComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectProduct(p: ProductSearchResult) {
    // synergy_product_id must hold Number(products.synergy_id) so the billing/work-order
    // PDF lookup (which queries products.synergy_id) resolves the product number.
    const id = Number(p.synergy_id)
    if (defaultProducts.some((dp) => dp.synergy_product_id === id || dp.synergy_product_id === p.id)) {
      setProductSearch('')
      setProductComboOpen(false)
      return
    }
    setDefaultProducts((prev) => [
      ...prev,
      {
        synergy_product_id: id,
        quantity: 1,
        description: `${p.number} - ${p.description ?? ''}`.trim(),
      },
    ])
    setProductSearch('')
    setProductComboOpen(false)
  }

  function updateProductQuantity(idx: number, delta: number) {
    setDefaultProducts((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p
      )
    )
  }

  function removeProduct(idx: number) {
    setDefaultProducts((prev) => prev.filter((_, i) => i !== idx))
  }

  function selectCustomer(c: CustomerOption) {
    setCustomerId(String(c.id))
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  function resetForm() {
    setCustomerSearch('')
    setCustomerId('')
    setCustomerResults([])
    setComboOpen(false)
    setShipToLocationId('')
    setShipToLocations([])
    setMake('')
    setModel('')
    setSerialNumber('')
    setDescription('')
    setLocationOnSite('')
    setContactName('')
    setContactEmail('')
    setContactPhone('')
    setDefaultTechId('')
    setDefaultProducts([])
    setProductSearch('')
    setProductResults([])
    setProductComboOpen(false)
    setAddSchedule(false)
    setIntervalMonths(3)
    setAnchorMonth(1)
    setBillingType('flat_rate')
    setFlatRate('')
    setError(null)
    setDuplicate(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setDuplicate(null)

    const supabase = createClient()
    const normalizedSerial = normalizeSerial(serialNumber)
    const customerIdNum = customerId ? parseInt(customerId) : null

    // Step 0: Duplicate-serial pre-check (active records, same customer, case/whitespace-insensitive)
    if (customerIdNum && normalizedSerial) {
      const { data: candidates, error: dupError } = await supabase
        .from('equipment')
        .select('id, make, model, serial_number')
        .eq('customer_id', customerIdNum)
        .eq('active', true)
        .ilike('serial_number', `%${normalizedSerial}%`)

      if (dupError) {
        setError(dupError.message)
        setLoading(false)
        return
      }

      const match = (candidates ?? []).find((row) => serialsMatch(row.serial_number, normalizedSerial))
      if (match) {
        setDuplicate({ id: match.id, make: match.make, model: match.model })
        setError(null)
        setLoading(false)
        return
      }
    }

    // Step 1: Insert equipment
    const { data: equipment, error: insertError } = await supabase
      .from('equipment')
      .insert({
        customer_id: customerIdNum,
        ship_to_location_id: shipToLocationId ? parseInt(shipToLocationId) : null,
        default_technician_id: defaultTechId || null,
        make: make || null,
        model: model || null,
        serial_number: normalizedSerial,
        description: description || null,
        location_on_site: locationOnSite || null,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        default_products: defaultProducts.length > 0 ? defaultProducts : [],
        active: true,
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === '23505' && insertError.message?.includes('idx_equipment_customer_serial')) {
        setError('This customer already has active equipment with that serial number.')
      } else {
        setError(insertError.message)
      }
      setLoading(false)
      return
    }

    // Step 2: Insert PM schedule if toggled on
    if (addSchedule && equipment) {
      const { error: scheduleError } = await supabase.from('pm_schedules').insert({
        equipment_id: equipment.id,
        interval_months: intervalMonths,
        anchor_month: anchorMonth,
        billing_type: billingType,
        flat_rate: billingType === 'flat_rate' ? parseFloat(flatRate) || null : null,
        active: true,
      })

      if (scheduleError) {
        setError(`Equipment created, but schedule failed: ${scheduleError.message}`)
        setLoading(false)
        onCreated()
        return
      }
    }

    resetForm()
    setLoading(false)
    onCreated()
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Add Equipment
          </h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {duplicate && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">
            This customer already has active equipment with that serial number
            {duplicate.make || duplicate.model
              ? ` — ${[duplicate.make, duplicate.model].filter(Boolean).join(' ')}`
              : ''}
            .{' '}
            <Link
              href={`/equipment/${duplicate.id}`}
              className="underline text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200"
            >
              View existing
            </Link>
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Customer combobox */}
          <div ref={comboRef} className="relative">
            <label className={labelClasses}>
              Customer
            </label>
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value)
                setCustomerId('')
              }}
              onFocus={() => { if (customerResults.length > 0) setComboOpen(true) }}
              placeholder="Search by name or account number..."
              autoComplete="off"
              className={inputClasses}
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
                    className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700 flex justify-between items-center"
                  >
                    <span className="text-gray-900 dark:text-white">{c.name}</span>
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
          </div>

          {/* Ship-To Location */}
          {customerId && shipToLocations.length > 0 && (
            <div>
              <label className={labelClasses}>
                Ship-To Location
              </label>
              <select
                value={shipToLocationId}
                onChange={(e) => setShipToLocationId(e.target.value)}
                className={inputClasses}
              >
                <option value="">Select location...</option>
                {shipToLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name ?? 'Unnamed'}{loc.city ? ` — ${loc.city}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClasses}>
                Make
              </label>
              <input
                type="text"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <label className={labelClasses}>
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>
          <div>
            <label className={labelClasses}>
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label className={labelClasses}>
              Serial Number
            </label>
            <input
              type="text"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label className={labelClasses}>
              Location on Site
            </label>
            <input
              type="text"
              value={locationOnSite}
              onChange={(e) => setLocationOnSite(e.target.value)}
              className={inputClasses}
            />
          </div>

          {/* Contact */}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Contact</label>
            <div className="space-y-2">
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Name"
                className={inputClasses}
              />
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email"
                className={inputClasses}
              />
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(formatPhoneNumber(e.target.value))}
                placeholder="(205) 555-1234"
                className={inputClasses}
              />
            </div>
          </div>

          {/* Default Technician */}
          <div>
            <label className={labelClasses}>
              Default Technician
            </label>
            <select
              value={defaultTechId}
              onChange={(e) => setDefaultTechId(e.target.value)}
              className={inputClasses}
            >
              <option value="">None</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* PM Schedule toggle + fields */}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={addSchedule}
                onChange={(e) => setAddSchedule(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-slate-800 focus:ring-slate-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Add PM Schedule</span>
            </label>

            {addSchedule && (
              <div className="mt-3 space-y-3 pl-6">
                <div>
                  <label className={labelClasses}>Frequency</label>
                  <select
                    value={intervalMonths}
                    onChange={(e) => setIntervalMonths(parseInt(e.target.value))}
                    className={inputClasses}
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>
                    Starting Month
                    <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(first month this PM runs)</span>
                  </label>
                  <select
                    value={anchorMonth}
                    onChange={(e) => setAnchorMonth(parseInt(e.target.value))}
                    className={inputClasses}
                  >
                    {MONTHS.map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Billing Type</label>
                  <select
                    value={billingType}
                    onChange={(e) => setBillingType(e.target.value as BillingType)}
                    className={inputClasses}
                  >
                    {BILLING_TYPES.map((b) => (
                      <option key={b.value} value={b.value}>{b.label}</option>
                    ))}
                  </select>
                </div>
                {billingType === 'flat_rate' && (
                  <div>
                    <label className={labelClasses}>Flat Rate ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={flatRate}
                      onChange={(e) => setFlatRate(e.target.value)}
                      className={inputClasses}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Default Products */}
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default Products
              <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(included on every PM at no charge)</span>
            </label>

            {/* Added products list */}
            {defaultProducts.length > 0 && (
              <div className="space-y-2 mb-3">
                {defaultProducts.map((dp, idx) => (
                  <div
                    key={dp.synergy_product_id}
                    className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2 text-sm"
                  >
                    <span className="flex-1 text-gray-900 dark:text-white truncate">{dp.description}</span>
                    <button
                      type="button"
                      onClick={() => updateProductQuantity(idx, -1)}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-gray-700 dark:text-gray-300 font-medium w-6 text-center">{dp.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateProductQuantity(idx, 1)}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeProduct(idx)}
                      className="p-1 text-red-400 hover:text-red-600 ml-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Product search */}
            <div ref={productComboRef} className="relative">
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                onFocus={() => { if (productResults.length > 0) setProductComboOpen(true) }}
                placeholder="Search products by number or description..."
                autoComplete="off"
                className={inputClasses}
              />
              {productSearching && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>
              )}
              {productComboOpen && productResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-auto text-sm">
                  {productResults.map((p) => (
                    <li
                      key={p.id}
                      onMouseDown={() => selectProduct(p)}
                      className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{p.number}</span>
                      {p.description && (
                        <span className="text-gray-500 dark:text-gray-400 ml-2">{p.description}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {productComboOpen && !productSearching && productSearch.trim() && productResults.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No products found.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
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
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 dark:bg-slate-700 rounded-md hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating...' : 'Add Equipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
