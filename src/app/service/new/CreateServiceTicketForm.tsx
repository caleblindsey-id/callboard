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

  // --- Ship-to ---
  const [shipTos, setShipTos] = useState<ShipToLocationRow[]>([])
  const [shipToId, setShipToId] = useState('')

  // --- Equipment ---
  const [equipment, setEquipment] = useState<EquipmentRow[]>([])
  const [equipmentLoaded, setEquipmentLoaded] = useState(false)
  const [equipmentId, setEquipmentId] = useState('')
  const [unknownEquipment, setUnknownEquipment] = useState(false)
  const [eqMake, setEqMake] = useState('')
  const [eqModel, setEqModel] = useState('')
  const [eqSerial, setEqSerial] = useState('')
  const [eqDescription, setEqDescription] = useState('')
  const [eqLocation, setEqLocation] = useState('')
  const [eqConflictId, setEqConflictId] = useState<string | null>(null)

  // --- Ticket fields ---
  const [ticketType, setTicketType] = useState<ServiceTicketType>('inside')
  const [billingType, setBillingType] = useState<ServiceBillingType>('non_warranty')
  const [priority, setPriority] = useState<ServicePriority>('standard')
  const [laborRateType, setLaborRateType] = useState('standard')
  const [problemDescription, setProblemDescription] = useState('')

  // --- Diagnostic fee (optional — captured when already billed in Synergy) ---
  const [diagnosticInvoiceNumber, setDiagnosticInvoiceNumber] = useState('')
  const [diagnosticCharge, setDiagnosticCharge] = useState('')

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
      // Strip PostgREST filter-syntax chars before injecting into .or()
      const q = customerSearch.trim().replace(/[,()]/g, ' ')
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

  // Load ship-to locations when customer changes
  useEffect(() => {
    setShipTos([])
    setShipToId('')
    if (!customerId) return
    const supabase = createClient()
    supabase
      .from('ship_to_locations')
      .select('*')
      .eq('customer_id', customerId)
      .order('name')
      .then(({ data }) => {
        setShipTos((data as ShipToLocationRow[]) ?? [])
      })
  }, [customerId])

  // Load equipment when customer or ship-to changes (ship-to narrows the list)
  useEffect(() => {
    setEquipment([])
    setEquipmentLoaded(false)
    // Always clear new-equipment state when customer changes — even between two non-null
    // customers — so conflict links from the previous customer don't persist.
    setEquipmentId('')
    setUnknownEquipment(false)
    setEqMake('')
    setEqModel('')
    setEqSerial('')
    setEqDescription('')
    setEqLocation('')
    setEqConflictId(null)
    if (!customerId) return
    const supabase = createClient()
    let query = supabase
      .from('equipment')
      .select('*')
      .eq('customer_id', customerId)
      .eq('active', true)
    if (shipToId) {
      query = query.eq('ship_to_location_id', parseInt(shipToId, 10))
    }
    query.order('make').then(({ data }) => {
      const rows = (data ?? []) as EquipmentRow[]
      setEquipment(rows)
      setEquipmentLoaded(true)
      // Keep the current selection if still valid under the new filter; otherwise clear it.
      setEquipmentId((prev) => (prev && rows.some((e) => e.id === prev) ? prev : ''))
    })
  }, [customerId, shipToId])

  // Pre-fill contact and address when equipment is selected
  useEffect(() => {
    if (!equipmentId || equipmentId === '__unknown__') return
    const eq = equipment.find((e) => e.id === equipmentId)
    if (!eq) return

    // Pre-fill contact from equipment
    if (eq.contact_name) setContactName(eq.contact_name)
    if (eq.contact_email) setContactEmail(eq.contact_email)
    if (eq.contact_phone) setContactPhone(eq.contact_phone)

    // Pre-fill ship-to + service address from equipment's ship-to (only when ship-to is blank)
    if (eq.ship_to_location_id && !shipToId) {
      setShipToId(String(eq.ship_to_location_id))
      // Address fill happens in the shipToId effect below
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentId, equipment])

  // Pre-fill service address + contact fallbacks when ship-to changes
  useEffect(() => {
    if (!shipToId) return
    const loc = shipTos.find((s) => String(s.id) === shipToId)
    if (!loc) return
    if (loc.address) setServiceAddress(loc.address)
    if (loc.city) setServiceCity(loc.city)
    if (loc.state) setServiceState(loc.state)
    if (loc.zip) setServiceZip(loc.zip)
    // Fill contact from ship-to only if still empty
    setContactName((prev) => prev || loc.contact || '')
    setContactEmail((prev) => prev || loc.email || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipToId, shipTos])

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
      setEqDescription('')
      setEqLocation('')
      setEqConflictId(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Customer is required.')
      return
    }
    if (!problemDescription.trim()) {
      setError('Problem description is required.')
      return
    }
    if (!contactName.trim()) {
      setError('Contact name is required.')
      return
    }
    if (!contactEmail.trim() && !contactPhone.trim()) {
      setError('Provide at least a contact email or phone number.')
      return
    }

    // When registering new equipment, require at least a make or model
    if ((unknownEquipment || noEquipment) && !eqMake.trim() && !eqModel.trim()) {
      setError('Enter at least a make or model for the equipment.')
      return
    }

    setLoading(true)
    setEqConflictId(null)

    // Register new equipment first; ticket links to the resulting profile
    let resolvedEquipmentId = equipmentId || undefined
    if (unknownEquipment || noEquipment) {
      const eqRes = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          ship_to_location_id: shipToId ? parseInt(shipToId, 10) : undefined,
          make: eqMake || undefined,
          model: eqModel || undefined,
          serial_number: eqSerial || undefined,
          description: eqDescription || undefined,
          location_on_site: eqLocation || undefined,
          contact_name: contactName || undefined,
          contact_email: contactEmail || undefined,
          contact_phone: contactPhone || undefined,
        }),
      })
      const eqData = await eqRes.json().catch(() => ({}))
      if (eqRes.status === 409) {
        setEqConflictId(eqData.existing_id ?? null)
        setError('Equipment with this serial number already exists for this customer.')
        setLoading(false)
        return
      }
      if (!eqRes.ok) {
        setError(eqData.error ?? 'Failed to register equipment.')
        setLoading(false)
        return
      }
      resolvedEquipmentId = eqData.id
    }

    const diagnosticChargeParsed = diagnosticCharge.trim() ? parseFloat(diagnosticCharge) : NaN
    const diagnosticInvoiceTrimmed = diagnosticInvoiceNumber.trim()

    const payload: Record<string, unknown> = {
      customer_id: customerId,
      ship_to_location_id: shipToId ? parseInt(shipToId, 10) : undefined,
      ticket_type: ticketType,
      billing_type: billingType,
      priority,
      labor_rate_type: laborRateType,
      problem_description: problemDescription.trim(),
      contact_name: contactName || undefined,
      contact_email: contactEmail || undefined,
      contact_phone: contactPhone || undefined,
      assigned_technician_id: technicianId || undefined,
      diagnostic_charge: Number.isFinite(diagnosticChargeParsed) && diagnosticChargeParsed >= 0
        ? diagnosticChargeParsed
        : undefined,
      diagnostic_invoice_number: diagnosticInvoiceTrimmed || undefined,
    }

    // Equipment — link to existing or newly created profile
    if (resolvedEquipmentId) {
      payload.equipment_id = resolvedEquipmentId
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

            {/* Ship-to selector — optional */}
            {customerSelected && shipTos.length > 0 && (
              <div>
                <label className={labelClass}>Ship-To Location</label>
                <select
                  value={shipToId}
                  onChange={(e) => setShipToId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— No ship-to (enter address manually) —</option>
                  {shipTos.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                      {s.city || s.state ? ` — ${[s.city, s.state].filter(Boolean).join(', ')}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Selecting a ship-to filters equipment and pre-fills the service address.
                </p>
              </div>
            )}
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
                        : 'Select equipment or register new'}
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

            {/* New equipment registration form */}
            {(unknownEquipment || noEquipment) && (
              <div className="space-y-3">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  This equipment isn&apos;t on file yet — register it below. A profile will be created and linked to this ticket so service history is tracked. At least a make or model is required.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Make</label>
                    <input
                      type="text"
                      value={eqMake}
                      onChange={(e) => { setEqMake(e.target.value); setEqConflictId(null) }}
                      placeholder="e.g. Tennant"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Model</label>
                    <input
                      type="text"
                      value={eqModel}
                      onChange={(e) => { setEqModel(e.target.value); setEqConflictId(null) }}
                      placeholder="e.g. T7AMR"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Serial Number</label>
                    <input
                      type="text"
                      value={eqSerial}
                      onChange={(e) => { setEqSerial(e.target.value); setEqConflictId(null) }}
                      placeholder="e.g. 12345"
                      className={inputClass}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Notes / Description</label>
                    <input
                      type="text"
                      value={eqDescription}
                      onChange={(e) => setEqDescription(e.target.value)}
                      placeholder="e.g. Floor scrubber, Bay 3"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Location on Site</label>
                    <input
                      type="text"
                      value={eqLocation}
                      onChange={(e) => setEqLocation(e.target.value)}
                      placeholder="e.g. Warehouse A"
                      className={inputClass}
                    />
                  </div>
                </div>
                {eqConflictId && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Equipment with this serial number already exists for this customer.{' '}
                    <Link href={`/equipment/${eqConflictId}`} className="underline font-medium">
                      View existing
                    </Link>
                    {' '}— or select it from the equipment dropdown above.
                  </p>
                )}
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

            {/* Billing Type / Priority / Labor Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

              <div>
                <label className={labelClass}>Labor Rate</label>
                <select
                  value={laborRateType}
                  onChange={(e) => setLaborRateType(e.target.value)}
                  className={inputClass}
                >
                  <option value="standard">Standard</option>
                  <option value="industrial">Industrial</option>
                  <option value="vacuum">Vacuum</option>
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
                placeholder="Describe the problem..."
                rows={4}
                className={inputClass}
              />
            </div>

            {/* Diagnostic Fee — optional, when a prior diagnostic was already billed in Synergy */}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Diagnostic Fee <span className="normal-case font-normal text-gray-400 dark:text-gray-500">(if already billed in Synergy)</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Synergy Invoice #</label>
                  <input
                    type="text"
                    value={diagnosticInvoiceNumber}
                    onChange={(e) => setDiagnosticInvoiceNumber(e.target.value)}
                    placeholder="e.g. 612978"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Amount</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 dark:text-gray-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={diagnosticCharge}
                      onChange={(e) => setDiagnosticCharge(e.target.value)}
                      placeholder="0.00"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
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
                <label className={labelClass}>
                  Name <span className="text-red-500">*</span>
                </label>
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
            <p className="text-xs text-gray-400 dark:text-gray-500">
              At least an email or phone number is required.
            </p>
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
