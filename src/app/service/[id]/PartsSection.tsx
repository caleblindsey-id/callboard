'use client'

import Link from 'next/link'
import { ExternalLink, Trash2 } from 'lucide-react'
import PartSynergyPicker from '@/components/PartSynergyPicker'
import VendorPicker from '@/components/VendorPicker'
import TechEquipmentDetailsPanel from './TechEquipmentDetailsPanel'
import { partLabel } from '@/lib/parts'
import { formatDate } from '@/lib/format'
import type { ProductSearchResult, UseProductSearchReturn } from '@/lib/hooks/useProductSearch'
import { Badge, CardSection, SynergyNumberField } from './detail-ui'
import type {
  ServiceTicketDetail as ServiceTicketDetailType,
  PartRequest,
} from '@/types/service-tickets'

interface PartsSectionProps {
  ticket: ServiceTicketDetailType
  isManager: boolean
  isStaff: boolean
  isTech: boolean
  loading: boolean
  // Parts state — owned by the parent (completion copy + workflow card read it)
  partsRequested: PartRequest[]
  livePartsRequested: PartRequest[]
  partsReceivedCount: number
  allPartsReceived: boolean
  poDueDates: Record<string, string>
  machineComplete: boolean
  synergyOrderNumber: string
  // One-click promote (approved estimate's quoted parts → queue)
  canPromoteEstimateParts: boolean
  unpromotedEstimatePartsCount: number
  // Add-part form state — owned by the parent (handlers there consume it)
  showAddPart: boolean
  setShowAddPart: (open: boolean) => void
  newPartDesc: string
  setNewPartDesc: (v: string) => void
  newPartQty: string
  setNewPartQty: (v: string) => void
  newPartNumber: string
  setNewPartNumber: (v: string) => void
  newPartVendorItemCode: string
  setNewPartVendorItemCode: (v: string) => void
  newPartVendor: string
  setNewPartVendor: (v: string) => void
  newPartVendorCode: string
  setNewPartVendorCode: (v: string) => void
  newPartPrice: string
  setNewPartPrice: (v: string) => void
  newPartSynergyProductId: number | null
  newPartIsCatalog: boolean
  addPartReady: boolean
  // Catalog combobox — hook + outside-click ref live in the parent
  partSearch: UseProductSearchReturn
  partComboRef: React.RefObject<HTMLDivElement | null>
  setPartComboOpen: (open: boolean) => void
  // Actions — all mutate shared ticket state, so they live in the parent
  onRemovePartRequest: (index: number) => Promise<void>
  onUpdatePartStatus: (index: number, status: PartRequest['status']) => Promise<void>
  onResetPartStatus: (index: number) => Promise<void>
  onSavePartSynergy: (index: number, next: { product_number: string; synergy_product_id: number | null }) => Promise<void>
  onUpdatePartVendorItemCode: (index: number, code: string) => void
  onSavePartVendorItemCode: (index: number) => Promise<void>
  onUpdatePartPo: (index: number, poNumber: string) => void
  onSavePartPo: (index: number) => Promise<void>
  onEquipmentVerified: () => void
  onPromoteEstimateParts: () => Promise<void>
  onSelectCatalogPart: (p: ProductSearchResult) => void
  onClearCatalogPart: () => void
  onResetAddPartForm: () => void
  onAddPartRequest: () => Promise<void>
  onSaveSynergyOrderNumber: (value: string) => Promise<void>
}

/**
 * Section 5: Parts Requested — request list with staff ordering workflow
 * (Synergy item # / vendor item # / PO inputs, mark ordered/received/reset),
 * the one-click estimate-parts promote, and the add-part form with catalog
 * search. Extracted verbatim from ServiceTicketDetail (audit P3 refactor,
 * round 3). All state stays in the parent; this is a controlled component.
 */
export default function PartsSection({
  ticket,
  isManager,
  isStaff,
  isTech,
  loading,
  partsRequested,
  livePartsRequested,
  partsReceivedCount,
  allPartsReceived,
  poDueDates,
  machineComplete,
  synergyOrderNumber,
  canPromoteEstimateParts,
  unpromotedEstimatePartsCount,
  showAddPart,
  setShowAddPart,
  newPartDesc,
  setNewPartDesc,
  newPartQty,
  setNewPartQty,
  newPartNumber,
  setNewPartNumber,
  newPartVendorItemCode,
  setNewPartVendorItemCode,
  newPartVendor,
  setNewPartVendor,
  newPartVendorCode,
  setNewPartVendorCode,
  newPartPrice,
  setNewPartPrice,
  newPartSynergyProductId,
  newPartIsCatalog,
  addPartReady,
  partSearch,
  partComboRef,
  setPartComboOpen,
  onRemovePartRequest,
  onUpdatePartStatus,
  onResetPartStatus,
  onSavePartSynergy,
  onUpdatePartVendorItemCode,
  onSavePartVendorItemCode,
  onUpdatePartPo,
  onSavePartPo,
  onEquipmentVerified,
  onPromoteEstimateParts,
  onSelectCatalogPart,
  onClearCatalogPart,
  onResetAddPartForm,
  onAddPartRequest,
  onSaveSynergyOrderNumber,
}: PartsSectionProps) {
  return (
    <CardSection
      title={`Parts Requested${livePartsRequested.length > 0 ? ` (${partsReceivedCount}/${livePartsRequested.length} received)` : ''}`}
      open={
        // Pre-completion AND something pending → open by default
        ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled' &&
        (livePartsRequested.length === 0 || !allPartsReceived)
      }
      summarySuffix={allPartsReceived ? (
        <Badge label="All Received" classes="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" />
      ) : undefined}
    >
      {/* "View in Parts Queue" — consumes the Round A query-param contract.
          The link works regardless of Round A's filter shipping; if that
          round hasn't merged yet, parts-queue just shows its default view. */}
      {isStaff && partsRequested.length > 0 && (
        <div className="mb-3">
          <Link
            href={`/parts-queue?source=service&ticket=${ticket.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            View in Parts Queue
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      {partsRequested.length > 0 && (
        <>
          {allPartsReceived && (
            <div className="mb-3">
              <Badge label="All Parts Received" classes="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" />
            </div>
          )}
          <div className="space-y-2">
            {partsRequested.map((part, i) => {
              const statusColors: Record<string, string> = {
                pending_review: 'text-slate-600 dark:text-slate-400',
                requested: 'text-yellow-600 dark:text-yellow-400',
                ordered: 'text-blue-600 dark:text-blue-400',
                received: 'text-green-600 dark:text-green-400',
                from_stock: 'text-teal-600 dark:text-teal-400',
              }
              const statusLabels: Record<string, string> = {
                pending_review: 'In Review',
                requested: 'Requested',
                ordered: 'Ordered',
                received: 'Received',
                from_stock: 'From Stock',
              }
              return (
                <div key={i} className="flex flex-col gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium ${part.cancelled ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-white'}`}>{partLabel(part)}</span>
                      {part.product_number && isTech && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">#{part.product_number}</span>
                      )}
                      <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">x{part.quantity}</span>
                      {part.po_number && isTech && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">PO: {part.po_number}</span>
                      )}
                      {!part.cancelled && poDueDates[`${part.po_number ?? ''}|${part.product_number ?? ''}`] && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                          Est. arrival {formatDate(poDueDates[`${part.po_number ?? ''}|${part.product_number ?? ''}`])}
                        </div>
                      )}
                      {part.cancelled && part.cancel_reason && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">Cancelled — {part.cancel_reason}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {part.cancelled ? (
                        <span className="text-xs font-medium uppercase text-red-600 dark:text-red-400">Cancelled</span>
                      ) : (
                        <span className={`text-xs font-medium uppercase ${statusColors[part.status] ?? ''}`}>
                          {statusLabels[part.status] ?? part.status}
                        </span>
                      )}
                      {!part.cancelled && (part.status === 'pending_review' || part.status === 'requested') && (
                        <button
                          onClick={() => onRemovePartRequest(i)}
                          disabled={loading}
                          title="Remove part"
                          className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors rounded min-h-[44px] sm:min-h-0 flex items-center"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!part.cancelled && isStaff && part.status === 'requested' && (
                        <button
                          onClick={() => onUpdatePartStatus(i, 'ordered')}
                          disabled={loading || !synergyOrderNumber.trim() || !part.product_number?.trim()}
                          title={
                            !synergyOrderNumber.trim()
                              ? 'Enter Synergy Order # below first'
                              : !part.product_number?.trim()
                              ? 'Enter Synergy item # first'
                              : undefined
                          }
                          className="px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                        >
                          Mark Ordered
                        </button>
                      )}
                      {!part.cancelled && isStaff && part.status === 'ordered' && (
                        <button
                          onClick={() => onUpdatePartStatus(i, 'received')}
                          disabled={loading}
                          className="px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600 rounded hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                        >
                          Mark Received
                        </button>
                      )}
                      {!part.cancelled && isManager && (part.status === 'ordered' || part.status === 'received') && (
                        <button
                          onClick={() => onResetPartStatus(i)}
                          disabled={loading}
                          title={`Reset to ${part.status === 'received' ? 'ordered' : 'requested'}`}
                          className="px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
                        >
                          ↩ Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Synergy item # picker — staff only, required to mark ordered */}
                  {!part.cancelled && isStaff && (
                    <div className="ml-0 sm:ml-4">
                      <PartSynergyPicker
                        productNumber={part.product_number}
                        synergyProductId={part.synergy_product_id ?? null}
                        onChange={(next) => onSavePartSynergy(i, next)}
                        disabled={loading}
                      />
                    </div>
                  )}

                  {/* Vendor item code — staff only, free text */}
                  {!part.cancelled && isStaff && (
                    <div className="flex items-center gap-2 ml-0 sm:ml-4">
                      <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Vendor item #:</label>
                      <input
                        type="text"
                        value={part.vendor_item_code ?? ''}
                        onChange={(e) => onUpdatePartVendorItemCode(i, e.target.value)}
                        onBlur={() => onSavePartVendorItemCode(i)}
                        placeholder="Manufacturer / vendor part #"
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                    </div>
                  )}

                  {/* PO number input — staff can enter when marking ordered or after */}
                  {!part.cancelled && isStaff && (part.status === 'ordered' || part.status === 'received') && (
                    <div className="flex items-center gap-2 ml-0 sm:ml-4">
                      <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">PO #:</label>
                      <input
                        type="text"
                        value={part.po_number ?? ''}
                        onChange={(e) => onUpdatePartPo(i, e.target.value)}
                        onBlur={() => onSavePartPo(i)}
                        placeholder="Enter PO number"
                        className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Add part request — tech or staff. Blocked until the machine is
          identified (verified make/model on a linked unit, or make/model/
          serial on an inline ticket) so the office knows what it's for. The
          verify panel lives in the Diagnosis & Estimate step above. */}
      {ticket.status !== 'completed' && ticket.status !== 'billed' && ticket.status !== 'canceled' && (
        !machineComplete ? (
          ticket.equipment ? (
            // Linked equipment row — the tech verifies it via the
            // VerifyEquipmentPanel that lives in the estimate/completion form.
            <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              Verify the machine make, model, and serial number before requesting parts. Use the verify step in Diagnosis &amp; Estimate above.
            </div>
          ) : (
            // Inline-only ticket (no equipment row) — there's no verify panel,
            // so let the on-site tech fill the details right here (feedback #41).
            <div className="mt-2">
              <TechEquipmentDetailsPanel
                ticketId={ticket.id}
                make={ticket.equipment_make}
                model={ticket.equipment_model}
                serial={ticket.equipment_serial_number}
                onSaved={onEquipmentVerified}
              />
            </div>
          )
        ) : (
        <>
          {/* One-click promote — the approved estimate's quoted parts go to
              the parts queue as pending_review, no re-keying. Hidden once
              every estimate line has a matching request. */}
          {canPromoteEstimateParts && (
            <div className="mt-2">
              <button
                onClick={onPromoteEstimateParts}
                disabled={loading}
                className="px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
              >
                Add Estimate Parts to Queue ({unpromotedEstimatePartsCount})
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Sends the quoted parts from the approved estimate to the parts queue for office review.
              </p>
            </div>
          )}
          {!showAddPart ? (
            <button
              onClick={() => setShowAddPart(true)}
              className="text-sm font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white py-2 min-h-[44px] flex items-center mt-2"
            >
              + Request Part
            </button>
          ) : (
            <div className="mt-3 space-y-2 max-w-lg">
              {/* Part description — searches the Synergy product catalog.
                  Picking a stock item locks the description to a chip and
                  prefills item #, price, vendor, and vendor part #. */}
              {newPartIsCatalog ? (
                <div className="flex items-center gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 py-3 sm:py-2 text-sm text-gray-900 dark:text-white">
                  <span className="flex-1 truncate">
                    {newPartNumber ? <span className="font-mono">{newPartNumber}</span> : null}
                    {newPartNumber ? ' — ' : ''}{newPartDesc}
                  </span>
                  <button
                    type="button"
                    onClick={onClearCatalogPart}
                    title="Clear and enter manually"
                    className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0 p-1"
                  >
                    &times;
                  </button>
                </div>
              ) : (
                <div className="relative" ref={partComboRef}>
                  <input
                    type="text"
                    value={newPartDesc}
                    onChange={(e) => { setNewPartDesc(e.target.value); partSearch.setQuery(e.target.value) }}
                    onFocus={() => { if (partSearch.results.length > 0) setPartComboOpen(true) }}
                    placeholder="Search parts or type a description"
                    className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                  {partSearch.comboOpen && partSearch.results.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {partSearch.results.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSelectCatalogPart(p)}
                          className="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                        >
                          <span className="font-mono text-gray-900 dark:text-white">{p.number}</span>
                          {p.description && <span className="text-gray-500 dark:text-gray-400"> — {p.description}</span>}
                          {p.unit_price != null && (
                            <span className="text-green-700 dark:text-green-400 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">${p.unit_price.toFixed(2)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {partSearch.comboOpen && !partSearch.loading && partSearch.results.length === 0 && newPartDesc.trim() && (
                    <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                      No catalog match — enter the part details manually below.
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  value={newPartQty}
                  onChange={(e) => setNewPartQty(e.target.value)}
                  placeholder="Qty"
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
                <input
                  type="text"
                  value={newPartNumber}
                  onChange={(e) => setNewPartNumber(e.target.value)}
                  placeholder="Synergy item # (optional)"
                  className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              {/* Vendor — Synergy-only picker. Prefilled (with a "synergy"
                  badge) when a catalog item is chosen; key remounts it so the
                  collapsed badge reflects the prefilled vendor / a cleared field. */}
              <VendorPicker
                key={`add-part-vendor-${newPartSynergyProductId ?? 'manual'}`}
                vendor={newPartVendor}
                vendorCode={newPartVendorCode}
                onChange={({ vendor, vendor_code }) => { setNewPartVendor(vendor); setNewPartVendorCode(vendor_code) }}
              />
              <input
                type="text"
                value={newPartVendorItemCode}
                onChange={(e) => setNewPartVendorItemCode(e.target.value)}
                placeholder={newPartIsCatalog ? 'Vendor part # (optional)' : 'Vendor part # (required)'}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={newPartPrice}
                onChange={(e) => setNewPartPrice(e.target.value)}
                placeholder={newPartIsCatalog ? 'Price to charge customer (optional; enter 0 if warranty)' : 'Price to charge customer (required; enter 0 if warranty)'}
                className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={onAddPartRequest}
                  disabled={loading || !addPartReady}
                  title={addPartReady ? 'Request this part to be ordered' : 'Enter vendor name, vendor part #, description, and price first'}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  {loading ? 'Adding...' : 'Add Part'}
                </button>
                <button
                  onClick={onResetAddPartForm}
                  className="px-4 py-3 sm:py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors min-h-[44px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
        )
      )}

      {/* Synergy order # — staff only, for the parts-ordering flow (pre-completion).
          On completed/billed tickets the field lives in the Actions card instead. */}
      {isStaff && !['open', 'canceled', 'declined', 'completed', 'billed'].includes(ticket.status) && (
        <SynergyNumberField
          initialValue={ticket.synergy_order_number ?? ''}
          onSave={onSaveSynergyOrderNumber}
          loading={loading}
        />
      )}
    </CardSection>
  )
}
