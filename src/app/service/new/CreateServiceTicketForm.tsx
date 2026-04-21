'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import CreditHoldBadge from '@/components/CreditHoldBadge'
import type { EquipmentRow, UserRow, ContactRow, ShipToLocationRow } from '@/types/database'
import type { ServiceTicketType, ServiceBillingType, ServicePriority } from '@/types/service-tickets'

interface CustomerOption {
  id: number
  name: string
  account_number: string | null
  credit_hold: boolean
}

export function CreateServiceTicketForm() {
  const router = useRouter()

  // --- Customer search ---
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState<number | null>(null)
  const [selectedCustomerName, setSelectedCustomerName] = useState('')
  const [selectedCustomerCreditHold, setSelectedCustomerCreditHold] = useState(false)
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  // --- Equipment ---
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [equipmentLoaded, setEquipmentLoaded] = useState(false)
  const [equipmentId, setEquipmentId] = useState('')
  const [unknownEquipment, setUnknownEquipment] = useState(false)
  const [eqMake, setEqMake] = useState('')
  const [eqModel, setEqModel] = useState('')
  const [eqSerial, setEqSerial] = useState('')

  // --- Ticket fields ---
  const [ticketType, setTicketType] = useState<ServiceTicketType>('inside')
  const [billingType, setBillingType] = useState<ServiceBillingType>('non_warranty')
  const [priority, setPriority] = useState<ServicePriority>('standard')
  const [problemDescription, setProblemDescription] = useState('')

  // --- Contact ---
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')

  // --- Service address (outside only) ---
  const [serviceAddress, setServiceAddress] = useState('')
  const [serviceCity, setServiceCity] = useState('')
  const [serviceState, setServiceState] = useState('')
  const [serviceZip, setServiceZip] = useState('')

  // --- Technician ---
  const [technicians, setTechnicians] = useState<UserRow[]>([])
  const [technicianId, setTechnicianId] = useState('')

  // --- Submission ---
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load technicians on mount
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('users')
      .select('*')
      .eq('active', true)
      .eq('role', 'technician')
      .order('name')
      .then(({ data }) => {
        if (data) setTechnicians(data)
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
        .select('id, name, account_number, credit_hold')
        .or(`name.ilike.%${q}%,account_number.ilike.%${q}%`)
        .eq('active', true)
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

  // Load equipment when customer changes
  useEffect(() => {
    setEquipmentId('')
    setEquipment([])
    setEquipmentLoaded(false)
    setUnknownEquipment(false)
    setEqMake('')
    setEqModel('')
    setEqSerial('')
    if (!customerId) return
    const supabase = createClient()
    supabase
      .from('equipment')
      .select('*')
      .eq('customer_id', customerId)
      .eq('active', true)
      .order('make')
      .then(({ data }) => {
        setEquipment(data ?? [])
        setEquipmentLoaded(true)
      })
  }, [customerId])

  // Pre-fill contact and address when equipment is selected
  useEffect(() => {
    if (!equipmentId || equipmentId === '__unknown__') return
    const eq = equipment.find((e) => e.id === equipmentId)
    if (!eq) return

    // Pre-fill contact from equipment
    if (eq.contact_name) setContactName(eq.contact_name)
    if (eq.contact_email) setContactEmail(eq.contact_email)
    if (eq.contact_phone) setContactPhone(eq.contact_phone)

    // Pre-fill service address from ship-to location
    if (eq.ship_to_location_id) {
      const supabase = createClient()
      supabase
        .from('ship_to_locations')
        .select('*')
        .eq('id', eq.ship_to_location_id)
        .single()
        .then(({ data }) => {
          if (data) {
            const loc = data as ShipToLocationRow
            if (loc.address) setServiceAddress(loc.address)
            if (loc.city) setServiceCity(loc.city)
            if (loc.state) setServiceState(loc.state)
            if (loc.zip) setServiceZip(loc.zip)
            // Also fill contact from ship-to if equipment contact is empty
            if (!eq.contact_name && loc.contact) setContactName(loc.contact)
            if (!eq.contact_email && loc.email) setContactEmail(loc.email)
          }
        })
    }
  }, [equipmentId, equipment])

  // Pre-fill contact from customer's primary contact when customer selected
  useEffect(() => {
    if (!customerId) return
    const supabase = createClient()
    supabase
      .from('contacts')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_primary', true)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const c = data[0] as ContactRow
          if (c.name && !contactName) setContactName(c.name)
          if (c.email && !contactEmail) setContactEmail(c.email)
          if (c.phone && !contactPhone) setContactPhone(c.phone)
        }
      })
    // Only run on customer change, not on contact field changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  function selectCustomer(c: CustomerOption) {
    setCustomerId(c.id)
    setSelectedCustomerName(c.name)
    setSelectedCustomerCreditHold(c.credit_hold)
    setCustomerSearch(c.account_number ? `${c.name} (${c.account_number})` : c.name)
    setComboOpen(false)
  }

  function handleEquipmentChange(value: string) {
    if (value === '__unknown__') {
      setEquipmentId('')
      setUnknownEquipment(true)
    } else {
      setEquipmentId(value)
      setUnknownEquipment(false)
      setEqMake('')
      setEqModel('')
      setEqSerial('')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Customer is required.')
      return
    }
    if (!problemDescription || problemDescription.trim().length < 10) {
      setError('Problem description must be at least 10 characters.')
      return
    }

    setLoading(true)

    const payload: Record<string, unknown> = {
      customer_id: customerId,
      ticket_type: ticketType,
      billing_type: billingType,
      priority,
      problem_description: problemDescription.trim(),
      contact_name: contactName || undefined,
      contact_email: contactEmail || undefined,
      contact_phone: contactPhone || undefined,
      assigned_technician_id: technicianId || undefined,
    }

    // Equipment — either existing or unknown inline fields
    if (equipmentId) {
      payload.equipment_id = equipmentId
    }
    if (unknownEquipment) {
      payload.equipment_make = eqMake || undefined
      payload.equipment_model = eqModel || undefined
      payload.equipment_serial_number = eqSerial || undefined
    }

    // Service address — outside tickets only
    if (ticketType === 'outside') {
      payload.service_address = serviceAddress || undefined
      payload.service_city = serviceCity || undefined
      payload.service_state = serviceState || undefined
      payload.service_zip = serviceZip || undefined
    }

    try {
      const res = await fetch('/api/service-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create service ticket')
        setLoading(false)
        return
      }
      router.push(`/service/${data.id}`)
    } catch {
      setError('Failed to create service ticket')
      setLoading(false)
    }
  }

  const customerSelected = !!customerId
  const noEquipment = customerSelected && equipmentLoaded && equipment.length === 0
  const totalSteps = ticketType === 'outside' ? 6 : 5

  // --- Shared input classes ---
  const inputClass =
    'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500'
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/service"
          className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Create Service Ticket
        </h1>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-3">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          {/* --- Customer --- */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Customer</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">1 of {totalSteps}</span>
            </div>
            <div ref={comboRef} className="relative">
              <label className={labelClass}>
                Customer <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setCustomerId(null)
                  setSelectedCustomerName('')
                  setSelectedCustomerCreditHold(false)
                }}
                onFocus={() => {
                  if (customerResults.length > 0) setComboOpen(true)
                }}
                placeholder="Search by name or account number..."
                autoComplete="off"
                className={inputClass}
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
                        <span className="text-gray-400 dark:text-gray-500 text-xs ml-2 shrink-0">
                          {c.account_number}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {comboOpen && !searching && customerSearch.trim() && customerResults.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No customers found.</p>
              )}
              {customerSelected && !selectedCustomerCreditHold && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                  Selected: {selectedCustomerName}
                </p>
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
          </div>

          {/* --- Equipment --- */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Equipment</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">2 of {totalSteps}</span>
            </div>
            <div>
              <label className={labelClass}>Equipment</label>
              {noEquipment ? (
                <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 px-3 py-2">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    No equipment on file for this customer — enter details below.
                  </p>
                </div>
              ) : (
                <select
                  value={unknownEquipment ? '__unknown__' : equipmentId}
                  onChange={(e) => handleEquipmentChange(e.target.value)}
                  disabled={!customerSelected}
                  className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500`}
                >
                  <option value="">
                    {!customerSelected
                      ? 'Select a customer first'
                      : !equipmentLoaded
                        ? 'Loading equipment...'
                        : 'Select equipment (optional)'}
                  </option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {[eq.make, eq.model].filter(Boolean).join(' ') || eq.id}
                      {eq.serial_number ? ` — SN: ${eq.serial_number}` : ''}
                      {eq.location_on_site ? ` (${eq.location_on_site})` : ''}
                    </option>
                  ))}
                  <option value="__unknown__">Unknown Equipment</option>
                </select>
              )}
            </div>

            {/* Unknown equipment inline fields */}
            {(unknownEquipment || noEquipment) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Make</label>
                  <input
                    type="text"
                    value={eqMake}
                    onChange={(e) => setEqMake(e.target.value)}
                    placeholder="e.g. Tennant"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    type="text"
                    value={eqModel}
                    onChange={(e) => setEqModel(e.target.value)}
                    placeholder="e.g. T7AMR"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Serial Number</label>
                  <input
                    type="text"
                    value={eqSerial}
                    onChange={(e) => setEqSerial(e.target.value)}
                    placeholder="e.g. 12345"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </div>

          {/* --- Ticket Details --- */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Ticket Details</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">3 of {totalSteps}</span>
            </div>

            {/* Ticket Type — radio buttons */}
            <div>
              <label className={labelClass}>
                Ticket Type <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-4 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="ticket_type"
                    value="inside"
                    checked={ticketType === 'inside'}
                    onChange={() => setTicketType('inside')}
                    className="accent-slate-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Inside (Shop)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="ticket_type"
                    value="outside"
                    checked={ticketType === 'outside'}
                    onChange={() => setTicketType('outside')}
                    className="accent-slate-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Outside (Field)
                  </span>
                </label>
              </div>
            </div>

            {/* Billing Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Billing Type</label>
                <select
                  value={billingType}
                  onChange={(e) => setBillingType(e.target.value as ServiceBillingType)}
                  className={inputClass}
                >
                  <option value="non_warranty">Non-Warranty</option>
                  <option value="warranty">Warranty</option>
                  <option value="partial_warranty">Partial Warranty</option>
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className={labelClass}>Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ServicePriority)}
                  className={inputClass}
                >
                  <option value="standard">Standard</option>
                  <option value="emergency">Emergency</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            {/* Problem Description */}
            <div>
              <label className={labelClass}>
                Problem Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={problemDescription}
                onChange={(e) => setProblemDescription(e.target.value)}
                placeholder="Describe the problem (at least 10 characters)..."
                rows={4}
                className={inputClass}
              />
            </div>
          </div>

          {/* --- Contact --- */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Contact</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">4 of {totalSteps}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Contact name"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="email@example.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="(205) 555-1234"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* --- Service Address (outside only) --- */}
          {ticketType === 'outside' && (
            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Service Address</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">5 of {totalSteps}</span>
            </div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Address</label>
                  <input
                    type="text"
                    value={serviceAddress}
                    onChange={(e) => setServiceAddress(e.target.value)}
                    placeholder="Street address"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className={labelClass}>City</label>
                    <input
                      type="text"
                      value={serviceCity}
                      onChange={(e) => setServiceCity(e.target.value)}
                      placeholder="City"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>State</label>
                    <input
                      type="text"
                      value={serviceState}
                      onChange={(e) => setServiceState(e.target.value)}
                      placeholder="AL"
                      maxLength={2}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Zip</label>
                    <input
                      type="text"
                      value={serviceZip}
                      onChange={(e) => setServiceZip(e.target.value)}
                      placeholder="35203"
                      maxLength={10}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- Assigned Technician --- */}
          <div className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Assignment</h2>
              <span className="text-xs text-gray-400 dark:text-gray-500">{totalSteps} of {totalSteps}</span>
            </div>
            <div>
              <label className={labelClass}>Assigned Technician</label>
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {technicians.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-4">
          <Link
            href="/service"
            className="px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Service Ticket'}
          </button>
        </div>
      </form>
    </div>
  )
}
