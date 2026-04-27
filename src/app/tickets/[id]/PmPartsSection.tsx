'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PartRequest, TicketStatus } from '@/types/database'
import { CheckCircle2, Package, Trash2 } from 'lucide-react'
import PartSynergyPicker from '@/components/PartSynergyPicker'
import PartsEntryList, { PartEntry } from '@/components/service/PartsEntryList'

interface PmPartsSectionProps {
  ticketId: string
  initialPartsRequested: PartRequest[]
  initialSynergyOrderNumber: string | null
  isTech: boolean
  canReset: boolean
  status: TicketStatus
}

const ENTRY_ALLOWED_STATUSES: TicketStatus[] = ['assigned', 'in_progress']

const STATUS_TEXT: Record<PartRequest['status'], string> = {
  requested: 'text-yellow-600 dark:text-yellow-400',
  ordered:   'text-blue-600 dark:text-blue-400',
  received:  'text-green-600 dark:text-green-400',
}

export default function PmPartsSection({
  ticketId,
  initialPartsRequested,
  initialSynergyOrderNumber,
  isTech,
  canReset,
  status,
}: PmPartsSectionProps) {
  const router = useRouter()
  const [parts, setParts] = useState<PartRequest[]>(initialPartsRequested)
  const [synergyOrderNumber, setSynergyOrderNumber] = useState(initialSynergyOrderNumber ?? '')
  const [synergyOrderSaved, setSynergyOrderSaved] = useState(!!initialSynergyOrderNumber)
  const [draftParts, setDraftParts] = useState<PartEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canRequestParts = ENTRY_ALLOWED_STATUSES.includes(status)

  const activeParts = parts.filter(p => !p.cancelled)
  const receivedCount = activeParts.filter(p => p.status === 'received').length
  const allReceived = activeParts.length > 0 && receivedCount === activeParts.length

  async function patchTicket(body: Record<string, unknown>) {
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to update ticket')
    }
  }

  async function handleRequestDraftPart(index: number) {
    const entry = draftParts[index]
    if (!entry || !entry.description.trim() || entry.alreadyRequested) return
    setSaving(true)
    setError(null)
    try {
      const newPart: PartRequest = {
        description: entry.description.trim(),
        quantity: entry.quantity || 1,
        ...(entry.productNumber?.trim() ? { product_number: entry.productNumber.trim() } : {}),
        ...(entry.synergyProductId != null ? { synergy_product_id: entry.synergyProductId } : {}),
        ...(entry.vendorItemCode?.trim() ? { vendor_item_code: entry.vendorItemCode.trim() } : {}),
        status: 'requested',
        requested_at: new Date().toISOString(),
      }
      const updated = [...parts, newPart]
      await patchTicket({ parts_requested: updated })
      setParts(updated)
      setDraftParts(prev => {
        const u = [...prev]
        if (u[index]) u[index] = { ...u[index], alreadyRequested: true }
        return u
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error requesting part')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdatePartStatus(index: number, status: PartRequest['status']) {
    if (status === 'ordered') {
      if (!synergyOrderSaved) {
        setError('Save the Synergy Order # before marking parts ordered.')
        return
      }
      const part = parts[index]
      if (!part.product_number?.trim()) {
        setError('Enter the Synergy item # for this part before marking it ordered.')
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const updated = parts.map((p, i) => i === index ? { ...p, status } : p)
      await patchTicket({ parts_requested: updated })
      setParts(updated)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating part status')
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePartSynergy(index: number, next: { product_number: string; synergy_product_id: number | null }) {
    setSaving(true)
    setError(null)
    try {
      const updated = parts.map((p, i) =>
        i === index
          ? {
              ...p,
              product_number: next.product_number,
              synergy_product_id: next.synergy_product_id ?? undefined,
            }
          : p
      )
      await patchTicket({ parts_requested: updated })
      setParts(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving Synergy item #')
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePartPo(index: number, poNumber: string) {
    setSaving(true)
    setError(null)
    try {
      const updated = parts.map((p, i) =>
        i === index ? { ...p, ...(poNumber ? { po_number: poNumber } : { po_number: undefined }) } : p
      )
      await patchTicket({ parts_requested: updated })
      setParts(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving PO number')
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePartVendorItemCode(index: number, code: string) {
    setSaving(true)
    setError(null)
    try {
      const trimmed = code.trim()
      const updated = parts.map((p, i) =>
        i === index ? { ...p, vendor_item_code: trimmed || undefined } : p
      )
      await patchTicket({ parts_requested: updated })
      setParts(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving vendor item code')
    } finally {
      setSaving(false)
    }
  }

  async function handleResetPartStatus(index: number) {
    const current = parts[index].status
    const prev: PartRequest['status'] = current === 'received' ? 'ordered' : 'requested'
    setSaving(true)
    setError(null)
    try {
      const updated = parts.map((p, i) => i === index ? { ...p, status: prev } : p)
      await patchTicket({ parts_requested: updated })
      setParts(updated)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error resetting part status')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePart(index: number) {
    setSaving(true)
    setError(null)
    try {
      const updated = parts.filter((_, i) => i !== index)
      await patchTicket({ parts_requested: updated })
      setParts(updated)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error deleting part')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveSynergyOrder() {
    setSaving(true)
    setError(null)
    try {
      await patchTicket({ synergy_order_number: synergyOrderNumber.trim() || null })
      setSynergyOrderSaved(!!synergyOrderNumber.trim())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving order number')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
        <Package className="h-4 w-4 text-gray-500 dark:text-gray-400 shrink-0" />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          Parts Requested
          {activeParts.length > 0 && (
            <span className="ml-2 text-gray-500 dark:text-gray-400 font-normal">
              ({receivedCount}/{activeParts.length} received)
            </span>
          )}
        </h2>
        {allReceived && (
          <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full font-medium">
            <CheckCircle2 className="h-3 w-3" /> All Received
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Parts list */}
        {parts.length > 0 && (
          <div>
            {parts.map((part, i) => (
              <div key={i} className="flex flex-col gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm font-medium ${part.cancelled ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{part.description}</span>
                    {part.product_number && isTech && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">#{part.product_number}</span>
                    )}
                    <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">x{part.quantity}</span>
                    {part.po_number && isTech && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">PO: {part.po_number}</span>
                    )}
                    {part.cancelled && part.cancel_reason && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">Cancelled — {part.cancel_reason}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {part.cancelled ? (
                      <span className="text-xs font-medium uppercase text-red-600 dark:text-red-400">Cancelled</span>
                    ) : (
                      <span className={`text-xs font-medium uppercase ${STATUS_TEXT[part.status]}`}>
                        {part.status}
                      </span>
                    )}
                    {!part.cancelled && part.status === 'requested' && (
                      <button
                        onClick={() => handleDeletePart(i)}
                        disabled={saving}
                        title="Remove part"
                        className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors rounded"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!part.cancelled && !isTech && part.status === 'requested' && (
                      <button
                        onClick={() => handleUpdatePartStatus(i, 'ordered')}
                        disabled={saving || !synergyOrderSaved || !part.product_number?.trim()}
                        title={
                          !synergyOrderSaved
                            ? 'Save Synergy Order # first'
                            : !part.product_number?.trim()
                            ? 'Enter Synergy item # first'
                            : undefined
                        }
                        className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 transition-colors"
                      >
                        Mark Ordered
                      </button>
                    )}
                    {!part.cancelled && !isTech && part.status === 'ordered' && (
                      <button
                        onClick={() => handleUpdatePartStatus(i, 'received')}
                        disabled={saving}
                        className="px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 min-h-[44px] sm:min-h-0 transition-colors"
                      >
                        Mark Received
                      </button>
                    )}
                    {!part.cancelled && canReset && (part.status === 'ordered' || part.status === 'received') && (
                      <button
                        onClick={() => handleResetPartStatus(i)}
                        disabled={saving}
                        title={`Reset to ${part.status === 'received' ? 'ordered' : 'requested'}`}
                        className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 min-h-[44px] sm:min-h-0 transition-colors"
                      >
                        ↩ Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Synergy item # picker — office staff only, required to mark ordered */}
                {!part.cancelled && !isTech && (
                  <div className="ml-0 sm:ml-4">
                    <PartSynergyPicker
                      productNumber={part.product_number}
                      synergyProductId={part.synergy_product_id ?? null}
                      onChange={next => handleSavePartSynergy(i, next)}
                      disabled={saving}
                    />
                  </div>
                )}

                {/* Vendor item code — office staff only, free text */}
                {!part.cancelled && !isTech && (
                  <div className="flex items-center gap-2 ml-0 sm:ml-4">
                    <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Vendor item #:</label>
                    <input
                      type="text"
                      defaultValue={part.vendor_item_code ?? ''}
                      placeholder="Manufacturer / vendor part #"
                      onBlur={e => handleSavePartVendorItemCode(i, e.target.value)}
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                )}

                {/* PO # input — office staff only, after ordered */}
                {!part.cancelled && !isTech && (part.status === 'ordered' || part.status === 'received') && (
                  <div className="flex items-center gap-2 ml-0 sm:ml-4">
                    <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">PO #:</label>
                    <input
                      type="text"
                      defaultValue={part.po_number ?? ''}
                      placeholder="Enter PO number"
                      onBlur={e => handleSavePartPo(i, e.target.value)}
                      className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Request part — product-search entry, only while ticket is active */}
        {canRequestParts && (
          <div className="mt-3">
            <PartsEntryList
              parts={draftParts}
              setParts={setDraftParts}
              showPricing={true}
              showWarranty={false}
              showVendorItemCode={true}
              label="Request a Part"
              onRequestPart={handleRequestDraftPart}
            />
          </div>
        )}

        {/* Synergy Order # — office staff only */}
        {!isTech && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wide">Synergy Ordering</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Order #</label>
                <input
                  type="text"
                  value={synergyOrderNumber}
                  onChange={e => { setSynergyOrderNumber(e.target.value); setSynergyOrderSaved(false) }}
                  placeholder="e.g. 612978"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleSaveSynergyOrder}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {synergyOrderSaved ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}
