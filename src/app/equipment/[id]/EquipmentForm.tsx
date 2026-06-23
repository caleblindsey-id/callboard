'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { EquipmentRow, UserRow } from '@/types/database'
import { formatPhoneNumber } from '@/lib/phone'
import { normalizeSerial, serialsMatch } from '@/lib/equipment'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import PropagateBillToModal, { type PropagationPayload } from './PropagateBillToModal'

type DuplicateMatch = {
  id: string
  make: string | null
  model: string | null
}

type CustomerOption = {
  id: number
  name: string
  account_number: string | null
}

type ShipToLocation = { id: number; name: string | null; city: string | null }

interface EquipmentFormProps {
  equipment: EquipmentRow & { customers: { name: string; account_number: string | null } | null }
  users: UserRow[]
  shipToLocations: ShipToLocation[]
  isTech?: boolean
  /** Whether this user (manager/super-admin) may reassign the bill-to account. */
  canEditBillTo?: boolean
}

function customerLabel(name: string, accountNumber: string | null): string {
  return accountNumber ? `${name} (${accountNumber})` : name
}

export default function EquipmentForm({ equipment, users, shipToLocations, isTech = false, canEditBillTo = false }: EquipmentFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null)
  const [success, setSuccess] = useState(false)
  // Set when a bill-to reassignment leaves open tickets stranded on the old
  // account — drives the "update open work orders too?" prompt.
  const [propagation, setPropagation] = useState<PropagationPayload | null>(null)

  // Bill-to account (customer) — managers can reassign equipment to the correct
  // Synergy account via a name/account-number search (same pattern as ticket
  // creation). Reassigning clears the ship-to, which belonged to the old account.
  const [customerId, setCustomerId] = useState<number | null>(equipment.customer_id ?? null)
  const [customerSearch, setCustomerSearch] = useState(
    equipment.customers ? customerLabel(equipment.customers.name, equipment.customers.account_number) : ''
  )
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([])
  const [comboOpen, setComboOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const comboRef = useRef<HTMLDivElement>(null)

  const [shipToOptions, setShipToOptions] = useState<ShipToLocation[]>(shipToLocations)

  const [make, setMake] = useState(equipment.make ?? '')
  const [model, setModel] = useState(equipment.model ?? '')
  const [serialNumber, setSerialNumber] = useState(equipment.serial_number ?? '')
  const [description, setDescription] = useState(equipment.description ?? '')
  const [locationOnSite, setLocationOnSite] = useState(equipment.location_on_site ?? '')
  const [blanketPoNumber, setBlanketPoNumber] = useState(equipment.blanket_po_number ?? '')
  const [contactName, setContactName] = useState(equipment.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(equipment.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(equipment.contact_phone ?? '')
  const [shipToLocationId, setShipToLocationId] = useState(String(equipment.ship_to_location_id ?? ''))
  const [defaultTechId, setDefaultTechId] = useState(equipment.default_technician_id ?? '')
  const [active, setActive] = useState(equipment.active)

  // Debounced customer search by name or account number. All state updates live
  // inside the debounced callback so nothing fires synchronously on render.
  useEffect(() => {
    if (!canEditBillTo) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const term = customerSearch.trim()
      if (!term) {
        setCustomerResults([])
        setComboOpen(false)
        return
      }
      setSearching(true)
      const supabase = createClient()
      const q = sanitizeOrValue(term)
      const { data } = await supabase
        .from('customers')
        .select('id, name, account_number')
        .or(safeOrRaw([
          { column: 'name', op: 'ilike', raw: `%${q}%` },
          { column: 'account_number', op: 'ilike', raw: `%${q}%` },
        ]))
        .eq('active', true)
        .order('name')
        .limit(25)
      setCustomerResults((data as CustomerOption[]) ?? [])
      setComboOpen(true)
      setSearching(false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [customerSearch, canEditBillTo])

  // Close the combobox on outside click.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // When the bill-to account is reassigned, reload ship-to options for the new
  // account. (The selection itself is cleared in selectCustomer, where the
  // reassignment originates.) Skip the first run so the server-provided options
  // survive initial render, and ignore the transient null that occurs mid-search.
  const firstCustomerRun = useRef(true)
  useEffect(() => {
    if (firstCustomerRun.current) {
      firstCustomerRun.current = false
      return
    }
    if (!customerId) return
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('ship_to_locations')
      .select('id, name, city')
      .eq('customer_id', customerId)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setShipToOptions((data as ShipToLocation[]) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [customerId])

  function selectCustomer(c: CustomerOption) {
    setCustomerId(c.id)
    setCustomerSearch(customerLabel(c.name, c.account_number))
    // The old ship-to belonged to the previous account; clear it on reassignment.
    setShipToLocationId('')
    setComboOpen(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setDuplicate(null)
    setSuccess(false)

    // Equipment must always belong to a bill-to account.
    if (canEditBillTo && !customerId) {
      setError('Select a bill-to account.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const normalizedSerial = normalizeSerial(serialNumber)

    // Duplicate-serial pre-check (only for managers editing serial/active, and only when the
    // target state is active with a serial and customer set). Checks against the
    // selected bill-to account, which may differ from the equipment's original one.
    if (!isTech && active && normalizedSerial && customerId) {
      const { data: candidates, error: dupError } = await supabase
        .from('equipment')
        .select('id, make, model, serial_number')
        .eq('customer_id', customerId)
        .eq('active', true)
        .neq('id', equipment.id)
        .ilike('serial_number', `%${normalizedSerial}%`)

      if (dupError) {
        setError(dupError.message)
        setLoading(false)
        return
      }

      const match = (candidates ?? []).find((row) => serialsMatch(row.serial_number, normalizedSerial))
      if (match) {
        setDuplicate({ id: match.id, make: match.make, model: match.model })
        setLoading(false)
        return
      }
    }

    const updateData = isTech
      ? {
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
        }
      : {
          // Only managers/super-admins may reassign the bill-to account.
          ...(canEditBillTo ? { customer_id: customerId } : {}),
          make: make || null,
          model: model || null,
          serial_number: normalizedSerial,
          description: description || null,
          location_on_site: locationOnSite || null,
          blanket_po_number: blanketPoNumber || null,
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
          ship_to_location_id: shipToLocationId ? parseInt(shipToLocationId) : null,
          default_technician_id: defaultTechId || null,
          active,
        }

    // Route through the server-side equipment PATCH so the role/field
    // allowlist is enforced server-side, not just by client-side branching.
    const res = await fetch(`/api/equipment/${equipment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data?.error || 'Failed to save equipment.')
    } else {
      setSuccess(true)
      // If reassigning the bill-to stranded open tickets on the old account,
      // prompt to repoint them too. The modal's onClose refreshes the page.
      if (data?.propagation) {
        setPropagation(data.propagation as PropagationPayload)
      } else {
        router.refresh()
      }
    }
    setLoading(false)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-4">
        Equipment Details
      </h2>
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
      {success && <p className="text-sm text-green-600 dark:text-green-400 mb-3">Saved.</p>}
      <form onSubmit={handleSubmit} className="space-y-3 max-w-xl">
        <div ref={comboRef} className="relative">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bill-To Account</label>
          {!canEditBillTo ? (
            <input type="text" value={customerSearch} disabled className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
          ) : (
            <>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setCustomerId(null)
                }}
                onFocus={() => {
                  if (customerResults.length > 0) setComboOpen(true)
                }}
                placeholder="Search by name or account number..."
                autoComplete="off"
                className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
                      <span className="text-gray-900 dark:text-white truncate">{c.name}</span>
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
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No accounts found.</p>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Changing the bill-to account clears the ship-to location below.
              </p>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Make</label>
            <input type="text" value={make} onChange={(e) => setMake(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model</label>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Serial Number</label>
          <input type="text" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location on Site</label>
          <input type="text" value={locationOnSite} onChange={(e) => setLocationOnSite(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Blanket PO Number</label>
          <input type="text" value={blanketPoNumber} onChange={(e) => setBlanketPoNumber(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Contact</label>
          <div className="space-y-2">
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Name" className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500" />
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Email" className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500" />
            <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(formatPhoneNumber(e.target.value))} placeholder="(205) 555-1234" className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ship-To Location</label>
          <select value={shipToLocationId} onChange={(e) => setShipToLocationId(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800">
            <option value="">None</option>
            {shipToOptions.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name ?? 'Unnamed'}{loc.city ? ` — ${loc.city}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Technician</label>
          <select value={defaultTechId} onChange={(e) => setDefaultTechId(e.target.value)} disabled={isTech} className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:bg-gray-50 disabled:text-gray-500 dark:disabled:bg-gray-800">
            <option value="">None</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        {!isTech && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="active"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <label htmlFor="active" className="text-sm text-gray-700 dark:text-gray-300">Active</label>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : isTech ? 'Save Contact' : 'Save Changes'}
        </button>
      </form>

      {propagation && (
        <PropagateBillToModal
          equipmentId={equipment.id}
          payload={propagation}
          onClose={() => {
            setPropagation(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
