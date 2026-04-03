'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TicketDetail } from '@/lib/db/tickets'
import { PartUsed, UserRole } from '@/types/database'
import { createClient } from '@/lib/supabase/client'

interface ProductResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
}

interface PartEntry {
  description: string
  quantity: number
  unitPrice: number
  synergyProductId: number | null
  isFromDb: boolean
  // Per-part search state
  searchOpen: boolean
  searchResults: ProductResult[]
  searching: boolean
}

interface TicketActionsProps {
  ticket: TicketDetail
  userRole: UserRole | null
  userId: string | null
  laborRate: number
}

export default function TicketActions({ ticket, userRole, userId, laborRate }: TicketActionsProps) {
  const router = useRouter()
  const pathname = usePathname()

  const isTech = userRole === 'technician'

  const billingType = ticket.schedule?.billing_type ?? null
  const flatRate = ticket.schedule?.flat_rate ?? null
  const isFlatRate = billingType === 'flat_rate' && flatRate != null

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Service request state
  const [serviceRequestOpen, setServiceRequestOpen] = useState(false)
  const [serviceRequestDesc, setServiceRequestDesc] = useState('')
  const [serviceRequestLoading, setServiceRequestLoading] = useState(false)
  const [serviceRequestSuccess, setServiceRequestSuccess] = useState(false)

  // Completion form state
  const [completedDate, setCompletedDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [hoursWorked, setHoursWorked] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [billingAmount, setBillingAmount] = useState(
    isFlatRate && flatRate != null ? String(flatRate) : ''
  )
  const [parts, setParts] = useState<PartEntry[]>([])

  const debounceRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const comboRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      comboRefs.current.forEach((el, idx) => {
        if (el && !el.contains(e.target as Node)) {
          setParts((prev) => {
            if (!prev[idx]?.searchOpen) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], searchOpen: false }
            return updated
          })
        }
      })
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleStart() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start ticket')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const partsUsed: PartUsed[] = parts.map((p) => ({
        synergy_product_id: p.synergyProductId ? Number(p.synergyProductId) : null,
        description: p.description,
        quantity: p.quantity,
        unit_price: p.unitPrice,
      }))

      const res = await fetch(`/api/tickets/${ticket.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completedDate,
          hoursWorked: parseFloat(hoursWorked) || 0,
          partsUsed,
          completionNotes,
          billingAmount: isTech
            ? (isFlatRate ? flatRate! : 0)
            : (parseFloat(billingAmount) || 0),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to complete ticket')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleServiceRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!serviceRequestDesc.trim()) return
    setServiceRequestLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tickets/service-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentTicketId: ticket.id,
          description: serviceRequestDesc.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create service request')
      }
      setServiceRequestDesc('')
      setServiceRequestOpen(false)
      setServiceRequestSuccess(true)
      setTimeout(() => setServiceRequestSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setServiceRequestLoading(false)
    }
  }

  function addPart() {
    setParts([...parts, {
      description: '',
      quantity: 1,
      unitPrice: 0,
      synergyProductId: null,
      isFromDb: false,
      searchOpen: false,
      searchResults: [],
      searching: false,
    }])
  }

  function handlePartDescriptionChange(index: number, value: string) {
    const updated = [...parts]
    updated[index] = {
      ...updated[index],
      description: value,
      // If they're typing, clear any previous DB selection
      isFromDb: false,
      synergyProductId: null,
    }
    setParts(updated)

    // Debounced product search
    const existing = debounceRefs.current.get(index)
    if (existing) clearTimeout(existing)

    if (!value.trim()) {
      updated[index].searchOpen = false
      updated[index].searchResults = []
      setParts([...updated])
      return
    }

    debounceRefs.current.set(index, setTimeout(async () => {
      setParts((prev) => {
        const u = [...prev]
        u[index] = { ...u[index], searching: true }
        return u
      })

      const supabase = createClient()
      const q = value.trim()
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description, unit_price')
        .or(`number.ilike.%${q}%,description.ilike.%${q}%`)
        .order('number')
        .limit(25)

      setParts((prev) => {
        const u = [...prev]
        if (u[index]) {
          u[index] = {
            ...u[index],
            searchResults: (data as ProductResult[]) ?? [],
            searchOpen: true,
            searching: false,
          }
        }
        return u
      })
    }, 300))
  }

  function selectProduct(index: number, product: ProductResult) {
    const updated = [...parts]
    updated[index] = {
      ...updated[index],
      description: `${product.number} - ${product.description ?? ''}`,
      unitPrice: isTech ? 0 : (product.unit_price ?? 0),
      synergyProductId: Number(product.synergy_id),
      isFromDb: true,
      searchOpen: false,
      searchResults: [],
    }
    setParts(updated)
  }

  function clearProduct(index: number) {
    const updated = [...parts]
    updated[index] = {
      ...updated[index],
      description: '',
      unitPrice: 0,
      synergyProductId: null,
      isFromDb: false,
    }
    setParts(updated)
  }

  function updatePartField(
    index: number,
    field: 'quantity' | 'unitPrice',
    value: string | number
  ) {
    const updated = [...parts]
    if (field === 'quantity') {
      updated[index] = { ...updated[index], quantity: Number(value) }
    } else {
      updated[index] = { ...updated[index], unitPrice: Number(value) }
    }
    setParts(updated)
  }

  function removePart(index: number) {
    setParts(parts.filter((_, i) => i !== index))
    // Clean up refs
    debounceRefs.current.delete(index)
    comboRefs.current.delete(index)
  }

  const partsTotal = parts.reduce(
    (sum, p) => sum + p.quantity * p.unitPrice,
    0
  )

  const serviceRequestSection = (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
        Additional Service
      </h2>
      {serviceRequestSuccess && (
        <p className="text-sm text-green-600 mb-3">Service request created successfully.</p>
      )}
      {!serviceRequestOpen ? (
        <button
          onClick={() => setServiceRequestOpen(true)}
          className="px-4 py-3 sm:py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors min-h-[44px]"
        >
          Request Additional Service
        </button>
      ) : (
        <form onSubmit={handleServiceRequest} className="space-y-3 max-w-xl">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description of Additional Work Needed
            </label>
            <textarea
              value={serviceRequestDesc}
              onChange={(e) => setServiceRequestDesc(e.target.value)}
              rows={3}
              required
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
              placeholder="Describe the additional work diagnosed on-site..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={serviceRequestLoading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {serviceRequestLoading ? 'Creating...' : 'Submit Request'}
            </button>
            <button
              type="button"
              onClick={() => { setServiceRequestOpen(false); setServiceRequestDesc('') }}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )

  // Unassigned or assigned: show Start button
  if (ticket.status === 'unassigned' || ticket.status === 'assigned') {
    return (
      <>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
            Actions
          </h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={handleStart}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-orange-600 rounded-md hover:bg-orange-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Starting...' : 'Start Work'}
          </button>
        </div>
        {serviceRequestSection}
      </>
    )
  }

  // In progress: show completion form
  if (ticket.status === 'in_progress') {
    return (
      <>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
            Complete Ticket
          </h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <form onSubmit={handleComplete} className="space-y-4 max-w-xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Completion Date
              </label>
              <input
                type="date"
                required
                value={completedDate}
                onChange={(e) => setCompletedDate(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hours Worked
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                required
                value={hoursWorked}
                onChange={(e) => setHoursWorked(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="0.00"
              />
            </div>

            {/* Flat rate base — informational, shown above additional work */}
            {isFlatRate && (
              <div className="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-md border border-blue-100">
                <span className="text-sm font-medium text-blue-800">PM Service (Flat Rate)</span>
                <span className="text-sm font-semibold text-blue-800">${flatRate!.toFixed(2)}</span>
              </div>
            )}

            {/* Parts */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  {isTech
                    ? 'Parts Used (for inventory tracking — no charge)'
                    : isFlatRate
                      ? 'Additional Work (beyond PM agreement)'
                      : 'Parts Used'}
                </label>
                <button
                  type="button"
                  onClick={addPart}
                  className="text-xs font-medium text-slate-700 hover:text-slate-900 py-2 sm:py-0 min-h-[44px] sm:min-h-0 flex items-center"
                >
                  + Add Part
                </button>
              </div>
              {parts.length > 0 && (
                <div className="space-y-2">
                  {parts.map((part, i) => (
                    <div key={`new-part-${i}`} className="rounded-md border border-gray-200 p-3 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:flex sm:items-start sm:gap-2">
                      {/* Description with product search */}
                      <div
                        className="relative sm:flex-1"
                        ref={(el) => { comboRefs.current.set(i, el) }}
                      >
                        {part.isFromDb ? (
                          <div className="flex items-center gap-1 rounded-md border border-green-300 bg-green-50 px-3 py-2.5 sm:py-1.5 text-sm text-gray-900">
                            <span className="flex-1 truncate">{part.description}</span>
                            <button
                              type="button"
                              onClick={() => clearProduct(i)}
                              className="text-gray-400 hover:text-red-500 shrink-0 p-1"
                            >
                              &times;
                            </button>
                          </div>
                        ) : (
                          <input
                            type="text"
                            placeholder="Search products or type description..."
                            value={part.description}
                            onChange={(e) => handlePartDescriptionChange(i, e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-3 py-2.5 sm:py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                          />
                        )}
                        {part.searchOpen && part.searchResults.length > 0 && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                            {part.searchResults.map((product) => (
                              <button
                                key={product.id}
                                type="button"
                                onClick={() => selectProduct(i, product)}
                                className="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                              >
                                <span className="font-medium text-gray-900">{product.number}</span>
                                <span className="text-gray-500"> — {product.description ?? ''}</span>
                                {product.unit_price != null && (
                                  <span className="text-green-700 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">
                                    ${product.unit_price.toFixed(2)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {part.searchOpen && !part.searching && part.searchResults.length === 0 && part.description.trim() && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500">
                            No products found — enter details manually
                          </div>
                        )}
                        {part.searching && (
                          <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500">
                            Searching...
                          </div>
                        )}
                      </div>
                      {/* Qty + Price + Remove row */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1 sm:flex-none">
                          <label className="block text-xs text-gray-500 mb-0.5 sm:hidden">Qty</label>
                          <input
                            type="number"
                            min="1"
                            placeholder="Qty"
                            value={part.quantity}
                            onChange={(e) => updatePartField(i, 'quantity', e.target.value)}
                            className="w-full sm:w-16 rounded-md border border-gray-300 px-2 py-2.5 sm:py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                          />
                        </div>
                        <div className="flex-1 sm:flex-none">
                          <label className="block text-xs text-gray-500 mb-0.5 sm:hidden">Price</label>
                          {isTech ? (
                            <input
                              type="number"
                              value={0}
                              readOnly
                              className="w-full sm:w-24 rounded-md border border-gray-200 bg-gray-50 px-2 py-2.5 sm:py-1.5 text-sm text-gray-400 cursor-not-allowed"
                            />
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="Price"
                              value={part.unitPrice}
                              onChange={(e) => updatePartField(i, 'unitPrice', e.target.value)}
                              readOnly={part.isFromDb}
                              className={`w-full sm:w-24 rounded-md border px-2 py-2.5 sm:py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                                part.isFromDb
                                  ? 'border-green-300 bg-green-50 cursor-not-allowed'
                                  : 'border-gray-300'
                              }`}
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removePart(i)}
                          className="text-gray-400 hover:text-red-500 text-sm p-2 sm:p-0 sm:mt-1 min-h-[44px] sm:min-h-0 flex items-center"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500">
                    Parts total: ${partsTotal.toFixed(2)}
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Completion Notes
              </label>
              <textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="Notes about the work performed..."
              />
            </div>

            {!isTech && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Billing Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={billingAmount}
                  onChange={(e) => setBillingAmount(e.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  placeholder="0.00"
                />
                {(parts.length > 0 || (isFlatRate && parseFloat(hoursWorked) > 0)) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {isFlatRate
                      ? `Suggested: $${(flatRate! + partsTotal + (parseFloat(hoursWorked) || 0) * laborRate).toFixed(2)} (flat rate + additional parts + $${laborRate}/hr labor)`
                      : `Suggested (T&M): $${(partsTotal + (parseFloat(hoursWorked) || 0) * laborRate).toFixed(2)} (parts + $${laborRate}/hr labor)`
                    }
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Completing...' : 'Mark Complete'}
            </button>
          </form>
        </div>
        {serviceRequestSection}
      </>
    )
  }

  async function handleReopen(targetStatus: 'in_progress' | 'unassigned' = 'in_progress') {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reopen ticket')
      }
      router.push(pathname)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Skipped: show reopen option for managers
  if (ticket.status === 'skipped') {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
          Ticket Skipped
        </h2>
        <p className="text-sm text-gray-500">This ticket was skipped and no work was performed.</p>
        {!isTech && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <button
              onClick={() => handleReopen('unassigned')}
              disabled={loading}
              className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 bg-white border border-orange-300 rounded-md hover:bg-orange-50 disabled:opacity-50 transition-colors min-h-[44px]"
            >
              {loading ? 'Reopening...' : 'Reopen Ticket'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // Completed or billed: read-only completion data
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">
        Completion Details
      </h2>
      {isFlatRate && flatRate != null && (
        <div className="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-md border border-blue-100 mb-4">
          <span className="text-sm font-medium text-blue-800">PM Service (Flat Rate)</span>
          <span className="text-sm font-semibold text-blue-800">${flatRate.toFixed(2)}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div>
          <span className="text-gray-500">Completed Date</span>
          <p className="text-gray-900 font-medium">
            {ticket.completed_date
              ? new Date(ticket.completed_date).toLocaleDateString()
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Hours Worked</span>
          <p className="text-gray-900 font-medium">
            {ticket.hours_worked ?? '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Billing Amount</span>
          <p className="text-gray-900 font-medium">
            {ticket.billing_amount != null
              ? `$${ticket.billing_amount.toFixed(2)}`
              : '—'}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Billing Exported</span>
          <p className="text-gray-900 font-medium">
            {ticket.billing_exported ? 'Yes' : 'No'}
          </p>
        </div>
      </div>
      {ticket.parts_used && ticket.parts_used.length > 0 && (
        <div className="mt-4">
          <span className="text-sm text-gray-500">
            {isFlatRate ? 'Additional Work' : 'Parts Used'}
          </span>
          <div className="mt-1 space-y-1">
            {ticket.parts_used.map((part, i) => (
              <div key={`${part.synergy_product_id ?? 'new'}-${i}`} className="text-sm text-gray-900">
                {part.description} — Qty: {part.quantity} @ $
                {part.unit_price.toFixed(2)}
              </div>
            ))}
          </div>
        </div>
      )}
      {ticket.completion_notes && (
        <div className="mt-4">
          <span className="text-sm text-gray-500">Notes</span>
          <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">
            {ticket.completion_notes}
          </p>
        </div>
      )}
      {ticket.status === 'completed' && !isTech && (
        <div className="mt-5 pt-4 border-t border-gray-200">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <button
            onClick={() => handleReopen('in_progress')}
            disabled={loading}
            className="px-4 py-3 sm:py-2 text-sm font-medium text-orange-700 bg-white border border-orange-300 rounded-md hover:bg-orange-50 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {loading ? 'Reopening...' : 'Reopen Ticket'}
          </button>
        </div>
      )}
    </div>
  )
}
