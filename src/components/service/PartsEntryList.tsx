'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { shouldSearchProducts, productDescriptionLines, productLabel } from '@/lib/products-search'
import { minPrice } from '@/lib/margin'
import VendorPicker from '@/components/VendorPicker'
import {
  SHIPPING_METHODS,
  SHIPPING_NOTE_MAX_LEN,
  shippingMethodLabel,
  type ShippingMethod,
} from '@/lib/shipping'

// ── Types (shared with ServiceTicketDetail) ──

export interface ProductResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  // Synergy's two 30-char description fields, unjoined (migration 167).
  // `description` stays the joined form; these let Desc2 — which carries the
  // office's item codes — render as its own line. NULL on rows not yet
  // re-synced since 167, so always read them via productDescriptionLines().
  description_1?: string | null
  description_2?: string | null
  unit_price: number | null
  // Loaded cost — only selected/used when allowPriceOverride is set (staff).
  // Never requested in tech-facing contexts. Backs the per-line margin floor.
  unit_cost?: number | null
  // Catch-all items (e.g. "SHOP SUPPLIES") set this so the entry form prompts
  // for a free-text detail of what the supplies actually were.
  requires_detail?: boolean
}

export interface PartEntry {
  description: string
  // Synergy Desc2 for the selected catalog part — the item code the office
  // keys on (feedback #96). Captured on select and persisted so the WO line
  // can show it as its own field instead of leaving it buried at the tail of
  // `description`. null on manual lines, on catalog parts with no Desc2, and on
  // every line saved before this field existed — all of which fall back to
  // showing `description`, which already contains the Desc2 text.
  description2?: string | null
  // quantity/unitPrice are kept as raw input strings (mirroring hoursWorked)
  // so the fields can be empty instead of showing a stray leading "0"/"1"
  // that the user has to delete. Parsed with parseFloat at the use sites.
  quantity: string
  unitPrice: string
  synergyProductId: number | null
  // Synergy item # (catalog number). Captured when a product is picked from the
  // product search so downstream flows (e.g. "Request this part" button) can
  // seed a PartRequest without the tech retyping it.
  productNumber: string | null
  isFromDb: boolean
  // Loaded cost for this catalog part, captured on select when the viewer can
  // override prices (staff). Drives the client-side margin-floor hint. null =
  // cost unknown (manual part, or staff-override off) — floor not shown.
  unitCost?: number | null
  searchOpen: boolean
  searchResults: ProductResult[]
  searching: boolean
  warrantyCovered: boolean
  // Actual amount the vendor credited for this line at warranty reconcile
  // (migration 160+, office-only — never surfaced in this component's UI).
  // Carried through the round-trip like fromRequestAt below so a tech
  // resubmitting the completion form after office reconcile can't silently
  // wipe it.
  vendorCreditAmount?: number | null
  // PM coverage classification, surfaced only when the parent opts in via
  // showCoverage (PM part requests). undefined = not yet chosen — the Request
  // gate blocks until the tech picks. true = included in the PM agreement (no
  // customer charge), false = billable. Distinct from warrantyCovered, which is
  // the service-ticket mechanism.
  coveredByAgreement?: boolean
  // Optional manufacturer / vendor part number. Only surfaced when the parent
  // opts in via showVendorItemCode (PM ticket parts requests use this).
  vendorItemCode?: string | null
  // Vendor name. Surfaced when the parent opts in via showVendor. Required on
  // new MANUAL part requests so the office isn't left guessing who to order
  // from; catalog parts resolve the vendor office-side. Picked from the Synergy
  // vendor master via VendorPicker (no free text) — set atomically with
  // vendorCode so the two never diverge.
  vendor?: string | null
  // Synergy a80vm.VendorCode paired with `vendor`. Set together by VendorPicker
  // when a Synergy vendor is selected; threaded into the PartRequest on Request.
  vendorCode?: string | null
  // Local flag flipped after the row has been sent to the parts-requested
  // queue via onRequestPart. Not persisted.
  alreadyRequested?: boolean
  // True when the selected catalog item is flagged products.requires_detail
  // (e.g. SHOP SUPPLIES) — surfaces the free-text detail input on this row.
  // Persisted onto the saved part so it survives reload (see partsFromSaved).
  requiresDetail?: boolean
  // Free-text "what were the supplies" entered by the tech. Optional.
  detail?: string
  // Link back to the originating part request (that request's requested_at),
  // set when the line was auto-added on fulfillment. Must survive this
  // round-trip: the completion form rehydrates from the saved array and PUTs it
  // back wholesale, so dropping the field here would strip the exact link off
  // every auto-added line the moment a tech opens the form, silently demoting
  // partsMissingFromWorkOrder() to description guessing. Same reason the vendor
  // fields are carried. Never edited in the UI.
  fromRequestAt?: string | null
  // Requested shipping speed + carrier note, surfaced when the parent opts in
  // via showShipping (feedback #80). Deliberately TRANSIENT: unlike the vendor
  // fields above, these are NOT persisted by toServicePartUsed, because the
  // arrays this component saves into (parts_used / estimate_parts) are the
  // billable work order and the customer quote — neither is a procurement
  // instruction. The value is read at the moment onRequestPart fires and
  // written onto the resulting PartRequest, which is where it belongs; from
  // then on the office owns it in the Parts Queue.
  shippingMethod?: ShippingMethod
  shippingNote?: string
}

export function emptyPart(): PartEntry {
  return {
    description: '',
    description2: null,
    quantity: '1',
    unitPrice: '',
    synergyProductId: null,
    productNumber: null,
    isFromDb: false,
    searchOpen: false,
    searchResults: [],
    searching: false,
    warrantyCovered: false,
    vendorItemCode: null,
    vendor: null,
    vendorCode: null,
  }
}

export function partsFromSaved(saved: { synergy_product_id?: number | null; description: string; description_2?: string | null; quantity: number; unit_price: number; warranty_covered?: boolean; vendor_credit_amount?: number | null; detail?: string; requires_detail?: boolean; product_number?: string; vendor_item_code?: string; vendor?: string; vendor_code?: string; from_request_at?: string }[]): PartEntry[] {
  return saved.map((p) => ({
    description: p.description,
    // Restore Desc2 so it survives the form round-trip (same reason as the
    // vendor fields below — the completion form PUTs the rehydrated array back
    // wholesale, so anything dropped here is stripped off the saved line).
    description2: p.description_2 ?? null,
    quantity: String(p.quantity),
    unitPrice: String(p.unit_price),
    synergyProductId: p.synergy_product_id ?? null,
    productNumber: p.product_number ?? null,
    isFromDb: p.synergy_product_id != null,
    searchOpen: false,
    searchResults: [],
    searching: false,
    warrantyCovered: p.warranty_covered ?? false,
    // Restore the office-set vendor credit (see PartEntry) so it survives a
    // tech resubmitting the form after warranty reconcile.
    vendorCreditAmount: p.vendor_credit_amount ?? null,
    // Restore the detail input on reload — requiresDetail is only set on the
    // product-select event, which never fires again on rehydrate.
    requiresDetail: !!p.requires_detail,
    detail: p.detail ?? '',
    // Restore sourcing fields so a part re-requested after a reload/reopen keeps
    // its vendor linkage (these are why the round-trip used to blank vendor +
    // vendor part #). Saved by toServicePartUsed below.
    vendorItemCode: p.vendor_item_code ?? null,
    vendor: p.vendor ?? null,
    vendorCode: p.vendor_code ?? null,
    // Preserve the auto-add link across the form round-trip (see PartEntry).
    fromRequestAt: p.from_request_at ?? null,
  }))
}

export function toServicePartUsed(entries: PartEntry[]): { synergy_product_id: number | null; description: string; description_2?: string; quantity: number; unit_price: number; warranty_covered: boolean; vendor_credit_amount?: number | null; detail?: string; requires_detail?: boolean; product_number?: string; vendor_item_code?: string; vendor?: string; vendor_code?: string; from_request_at?: string }[] {
  return entries.map((p) => ({
    synergy_product_id: p.synergyProductId ? Number(p.synergyProductId) : null,
    description: p.description,
    quantity: parseFloat(p.quantity) || 0,
    unit_price: parseFloat(p.unitPrice) || 0,
    warranty_covered: p.warrantyCovered,
    // Persist the office-set vendor credit through the round-trip (see
    // PartEntry) — only when set, so unreconciled lines stay lean.
    ...(p.vendorCreditAmount != null ? { vendor_credit_amount: p.vendorCreditAmount } : {}),
    // Synergy Desc2 (item code) for catalog lines. Only written when set, so
    // manual lines and pre-167 catalog picks stay exactly as lean as before.
    ...(p.description2?.trim() ? { description_2: p.description2.trim() } : {}),
    // Persist only when meaningful so non-flagged parts stay lean.
    ...(p.detail?.trim() ? { detail: p.detail.trim() } : {}),
    ...(p.requiresDetail ? { requires_detail: true } : {}),
    // Persist sourcing fields through the round-trip (see partsFromSaved). Only
    // when set, so vendor-less / non-catalog lines stay lean. Internal-only.
    ...(p.productNumber?.trim() ? { product_number: p.productNumber.trim() } : {}),
    ...(p.vendorItemCode?.trim() ? { vendor_item_code: p.vendorItemCode.trim() } : {}),
    ...(p.vendor?.trim() ? { vendor: p.vendor.trim() } : {}),
    ...(p.vendorCode?.trim() ? { vendor_code: p.vendorCode.trim() } : {}),
    ...(p.fromRequestAt ? { from_request_at: p.fromRequestAt } : {}),
  }))
}

// ── Component ──

interface PartsEntryListProps {
  parts: PartEntry[]
  setParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  showPricing: boolean
  showWarranty: boolean
  // Surface a required covered-vs-billable selector on each row (PM part
  // requests). When set alongside onRequestPart, the tech must pick before the
  // Request action unlocks, and a "covered" pick waives the manual-part price
  // requirement (covered parts are $0 to the customer).
  showCoverage?: boolean
  label?: string
  // Staff-only: unlock the price field on catalog parts (locked by default) and
  // fetch loaded cost so a per-line 15% margin floor can be shown. Never pass
  // true in a tech-facing context — it would expose cost-derived data.
  allowPriceOverride?: boolean
  // Unlock the catalog price field WITHOUT exposing cost or the margin floor —
  // for technicians, who may set the customer price but must never see loaded
  // cost or the min-price hint (the server still enforces the 15% floor and
  // rejects below-floor lines with a generic, cost-free message). Distinct from
  // allowPriceOverride, which is the staff mode (unlock + cost fetch + floor).
  allowPriceEdit?: boolean
  // Surface an optional vendor / manufacturer part # input on each row.
  showVendorItemCode?: boolean
  // Surface a vendor-name input on each row. When set alongside onRequestPart,
  // vendor name becomes a required field for MANUAL part requests.
  showVendor?: boolean
  // Surface the requested-shipping-speed picker + carrier note on each row
  // (feedback #80). Only meaningful alongside onRequestPart — the value is read
  // when the row is requested and carried onto the PartRequest. Never required:
  // 'standard' is a valid answer and the default, so the Request gate is
  // unchanged.
  showShipping?: boolean
  // When provided, each row renders a "Request" button that hands the entry
  // off to the caller (which creates a PartRequest on the ticket). The caller
  // is responsible for flipping `alreadyRequested` on success.
  onRequestPart?: (index: number) => Promise<void>
}

export default function PartsEntryList({ parts, setParts, showPricing, showWarranty, showCoverage = false, label = 'Parts', allowPriceOverride = false, allowPriceEdit = false, showVendorItemCode = false, showVendor = false, showShipping = false, onRequestPart }: PartsEntryListProps) {
  const debounceRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const comboRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  // Tracks which dropdown result is keyboard-highlighted per row (-1 = none)
  const [focusedIndices, setFocusedIndices] = useState<Record<number, number>>({})

  const clearFocus = useCallback((idx: number) => {
    setFocusedIndices((prev) => { const n = { ...prev }; delete n[idx]; return n })
  }, [])

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
          clearFocus(idx)
        }
      })
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [setParts, clearFocus])

  function handlePartSearch(index: number, value: string) {
    setParts((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], description: value, isFromDb: false, synergyProductId: null, productNumber: null, unitCost: null, requiresDetail: false }
      return updated
    })

    const existing = debounceRefs.current.get(index)
    if (existing) clearTimeout(existing)

    if (!shouldSearchProducts(value)) {
      setParts((prev) => {
        const updated = [...prev]
        if (updated[index]) {
          updated[index] = { ...updated[index], searchOpen: false, searchResults: [] }
        }
        return updated
      })
      return
    }

    debounceRefs.current.set(index, setTimeout(async () => {
      setParts((prev) => {
        const u = [...prev]
        if (u[index]) u[index] = { ...u[index], searching: true }
        return u
      })

      const supabase = createClient()
      // Sanitize before splicing into .or() — see lib/db/safe-or.
      const q = sanitizeOrValue(value.trim())
      // Cost is only pulled for staff who can override prices (drives the floor
      // hint). Tech-facing callers never request unit_cost.
      const cols = allowPriceOverride
        ? 'id, synergy_id, number, description, description_1, description_2, unit_price, unit_cost, requires_detail'
        : 'id, synergy_id, number, description, description_1, description_2, unit_price, requires_detail'
      const { data } = await supabase
        .from('products')
        .select(cols)
        .or(safeOrRaw([
          { column: 'number', op: 'ilike', raw: `%${q}%` },
          { column: 'description', op: 'ilike', raw: `%${q}%` },
          // Desc2 is already inside the joined `description`, so this is
          // redundant for pre-167 rows — but it is the field techs are now told
          // they can search by, and it is trigram-indexed (migration 167).
          { column: 'description_2', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('number')
        .limit(10)

      setParts((prev) => {
        const u = [...prev]
        if (u[index]) {
          u[index] = {
            ...u[index],
            // Cast via unknown: the select column list is built dynamically
            // (cost only for staff), so supabase-js can't statically type it.
            searchResults: (data as unknown as ProductResult[]) ?? [],
            searchOpen: true,
            searching: false,
          }
        }
        return u
      })
      // Reset keyboard focus whenever new results arrive
      clearFocus(index)
    }, 300))
  }

  function handleSelectProduct(index: number, product: ProductResult) {
    setParts((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        // Unchanged shape ("<number> - <desc1> <desc2>"): this string is the
        // billable line description and is matched against elsewhere, so it
        // must keep containing Desc2. description2 is carried alongside it
        // purely so the UI can also show that half on its own.
        description: productLabel(product),
        description2: productDescriptionLines(product).secondary,
        unitPrice: String(product.unit_price ?? 0),
        synergyProductId: Number(product.synergy_id),
        productNumber: product.number,
        isFromDb: true,
        unitCost: allowPriceOverride ? (product.unit_cost ?? null) : null,
        requiresDetail: !!product.requires_detail,
        searchOpen: false,
        searchResults: [],
      }
      return updated
    })
    clearFocus(index)
  }

  // Required-field gate for the "Request" action. Description is always
  // required; for MANUAL (off-catalog) parts the office can't fill the gaps
  // later, so vendor name, vendor part #, and a customer price are also
  // required — but only those fields that are actually visible in this context.
  // Catalog parts (isFromDb) resolve vendor/price office-side and stay exempt.
  function missingRequestFields(part: PartEntry): string[] {
    const missing: string[] = []
    if (!part.description.trim()) missing.push('description')
    // Force an explicit coverage pick on PM requests before the part can be
    // requested — covered vs billable drives downstream billing, so it must
    // never default silently.
    if (showCoverage && part.coveredByAgreement === undefined) missing.push('coverage')
    if (!part.isFromDb) {
      if (showVendor && !(part.vendor ?? '').trim()) missing.push('vendor')
      if (showVendorItemCode && !(part.vendorItemCode ?? '').trim()) missing.push('vendor part #')
      // Covered parts are $0 to the customer, so a manual price isn't required
      // for them; only billable (or coverage-not-shown) manual parts need one.
      const priceRequired = showPricing && !(showCoverage && part.coveredByAgreement === true)
      if (priceRequired) {
        const v = parseFloat(part.unitPrice)
        // A blank or non-numeric price is missing; a warranty $0 is entered as 0.
        if (part.unitPrice.trim() === '' || !Number.isFinite(v) || v < 0) missing.push('price')
      }
    }
    return missing
  }

  function handleClearProduct(index: number) {
    setParts((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], description: '', unitPrice: '', synergyProductId: null, productNumber: null, isFromDb: false, unitCost: null, requiresDetail: false, detail: '' }
      return updated
    })
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      {parts.length > 0 && (
        <div className="space-y-2">
          {parts.map((part, i) => (
            <div key={`part-${i}`} className="rounded-md border border-gray-200 dark:border-gray-700 p-3 space-y-2">
              {/* Product search / display */}
              <div
                className="relative min-w-0"
                ref={(el) => { comboRefs.current.set(i, el) }}
              >
                {part.isFromDb ? (
                  // Height is min-, not fixed, and the label wraps rather than
                  // ellipsing: Desc2 sits at the TAIL of the description, so a
                  // single-line `truncate` here ate the item code first — the
                  // exact complaint in feedback #96.
                  <div className="flex items-start gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 py-2 min-h-[44px] sm:min-h-[34px] text-sm text-gray-900 dark:text-white">
                    <span className="flex-1 min-w-0 break-words">{part.description}</span>
                    <button
                      type="button"
                      onClick={() => handleClearProduct(i)}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0 p-1"
                    >
                      &times;
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={part.description}
                    onChange={(e) => handlePartSearch(i, e.target.value)}
                    onKeyDown={(e) => {
                      const results = part.searchResults
                      const focused = focusedIndices[i] ?? -1
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        if (part.searchOpen && results.length > 0)
                          setFocusedIndices((prev) => ({ ...prev, [i]: Math.min(focused + 1, results.length - 1) }))
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        if (part.searchOpen && results.length > 0)
                          setFocusedIndices((prev) => ({ ...prev, [i]: Math.max(focused - 1, 0) }))
                      } else if (e.key === 'Enter') {
                        e.preventDefault()
                        if (part.searchOpen && results.length > 0)
                          handleSelectProduct(i, results[focused >= 0 ? focused : 0])
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setParts((prev) => {
                          const u = [...prev]
                          if (u[i]) u[i] = { ...u[i], searchOpen: false }
                          return u
                        })
                        clearFocus(i)
                      }
                    }}
                    className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                )}
                {part.searchOpen && part.searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {part.searchResults.map((product, ri) => {
                      const lines = productDescriptionLines(product)
                      return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleSelectProduct(i, product)}
                        className={`w-full text-left px-3 py-3 sm:py-2 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 ${
                          focusedIndices[i] === ri
                            ? 'bg-slate-100 dark:bg-slate-700'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{product.number}</span>
                        <span className="text-gray-500 dark:text-gray-400"> — {lines.primary}</span>
                        {/* Description 2 on its own line — this is where the
                            office's item codes live (feedback #96). Absent
                            until the product has been re-synced since 167. */}
                        {lines.secondary && (
                          <span className="block text-gray-600 dark:text-gray-300 font-mono text-xs mt-0.5">
                            {lines.secondary}
                          </span>
                        )}
                        {product.unit_price != null && (
                          <span className="text-green-700 dark:text-green-400 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">
                            ${product.unit_price.toFixed(2)}
                          </span>
                        )}
                      </button>
                      )
                    })}
                  </div>
                )}
                {part.searchOpen && !part.searching && part.searchResults.length === 0 && part.description.trim() && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                    No products found — enter details manually
                  </div>
                )}
                {part.searching && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-3 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                    Searching...
                  </div>
                )}
              </div>

              {/* Qty, Price, Warranty, Remove */}
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={part.quantity}
                    onChange={(e) => {
                      setParts((prev) => {
                        const u = [...prev]
                        u[i] = { ...u[i], quantity: e.target.value }
                        return u
                      })
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                    className="w-16 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-2 h-[44px] sm:h-[34px] text-sm text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                {showPricing && (() => {
                  // Catalog prices are locked unless the viewer can override
                  // (staff) or has plain edit rights (technicians — no cost/floor).
                  const locked = part.isFromDb && !allowPriceOverride && !allowPriceEdit
                  // Per-line floor: price must keep >= 15% margin over loaded
                  // cost. Only shown to staff; null cost = floor not enforced.
                  const floor = allowPriceOverride ? minPrice(part.unitCost) : null
                  const parsedPrice = parseFloat(part.unitPrice)
                  const belowFloor =
                    floor != null && Number.isFinite(parsedPrice) && parsedPrice + 0.005 < floor
                  return (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={part.unitPrice}
                      onChange={(e) => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], unitPrice: e.target.value }
                          return u
                        })
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                      readOnly={locked}
                      aria-invalid={belowFloor}
                      className={`w-24 rounded-md border px-2 h-[44px] sm:h-[34px] text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                        belowFloor
                          ? 'border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                          : locked
                            ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 cursor-not-allowed dark:text-white'
                            : 'border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600'
                      }`}
                    />
                    {floor != null && (
                      <p className={`mt-0.5 text-[11px] ${belowFloor ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                        Min ${floor.toFixed(2)}
                      </p>
                    )}
                    {allowPriceOverride && part.isFromDb && part.unitCost == null && (
                      <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                        Cost unknown — floor off
                      </p>
                    )}
                  </div>
                  )
                })()}
                {showWarranty && (
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer min-h-[44px] sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={part.warrantyCovered}
                      onChange={(e) => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], warrantyCovered: e.target.checked }
                          return u
                        })
                      }}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    Warranty
                  </label>
                )}
                {showVendor && (
                  <div className="w-56">
                    {/* Synergy-only vendor picker (no free text). Sets vendor +
                        vendorCode together so they never diverge. Keyed on the
                        catalog product so the picker re-inits when the row's
                        product changes. */}
                    <VendorPicker
                      key={`vendor-${i}-${part.synergyProductId ?? 'manual'}`}
                      vendor={part.vendor}
                      vendorCode={part.vendorCode}
                      onChange={({ vendor, vendor_code }) => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], vendor, vendorCode: vendor_code }
                          return u
                        })
                      }}
                    />
                  </div>
                )}
                {showVendorItemCode && (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Vendor Item #</label>
                    <input
                      type="text"
                      value={part.vendorItemCode ?? ''}
                      onChange={(e) => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], vendorItemCode: e.target.value }
                          return u
                        })
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                      placeholder={part.isFromDb ? 'optional' : 'required'}
                      className="w-32 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 h-[44px] sm:h-[34px] text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                )}
                {onRequestPart && (
                  part.alreadyRequested ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 px-2 min-h-[44px] sm:min-h-0">
                      ✓ Requested
                    </span>
                  ) : (() => {
                    const missing = missingRequestFields(part)
                    return (
                      <button
                        type="button"
                        disabled={missing.length > 0}
                        onClick={() => onRequestPart(i)}
                        title={missing.length > 0 ? `Add ${missing.join(', ')} first` : 'Request this part to be ordered'}
                        className="ml-auto px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 transition-colors"
                      >
                        Request
                      </button>
                    )
                  })()
                )}
                <button
                  type="button"
                  onClick={() => {
                    setParts((prev) => prev.filter((_, idx) => idx !== i))
                    debounceRefs.current.delete(i)
                    comboRefs.current.delete(i)
                  }}
                  className={`text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs min-h-[44px] sm:min-h-0 flex items-center px-1 ${onRequestPart ? '' : 'ml-auto'}`}
                >
                  Remove
                </button>
              </div>
              {/* Coverage — covered vs billable. Required pick on PM requests
                  (drives billing). Segmented two-option control, 44px targets. */}
              {showCoverage && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Billing <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={part.coveredByAgreement === true}
                      onClick={() => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], coveredByAgreement: true }
                          return u
                        })
                      }}
                      className={`flex-1 rounded-md border px-3 min-h-[44px] sm:min-h-[34px] text-sm font-medium transition-colors ${
                        part.coveredByAgreement === true
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      Included in PM agreement (no charge)
                    </button>
                    <button
                      type="button"
                      aria-pressed={part.coveredByAgreement === false}
                      onClick={() => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], coveredByAgreement: false }
                          return u
                        })
                      }}
                      className={`flex-1 rounded-md border px-3 min-h-[44px] sm:min-h-[34px] text-sm font-medium transition-colors ${
                        part.coveredByAgreement === false
                          ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      Not included — bill customer
                    </button>
                  </div>
                </div>
              )}

              {/* Requested shipping speed (feedback #80). Optional — 'standard'
                  is the default and a perfectly good answer, so unlike the
                  coverage picker above this never gates the Request button. The
                  note only appears once a rush is picked: a carrier instruction
                  on a ground order is noise the buyer doesn't need to read. */}
              {showShipping && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    Shipping
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {SHIPPING_METHODS.map((method) => {
                      const selected = (part.shippingMethod ?? 'standard') === method
                      return (
                        <button
                          key={method}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            setParts((prev) => {
                              const u = [...prev]
                              u[i] = {
                                ...u[i],
                                shippingMethod: method,
                                // Dropping back to standard clears the note too,
                                // so a stale "overnight, customer pays" can't
                                // ride along on a ground order.
                                ...(method === 'standard' ? { shippingNote: '' } : {}),
                              }
                              return u
                            })
                          }}
                          className={`flex-1 min-w-[96px] rounded-md border px-3 min-h-[44px] sm:min-h-[34px] text-sm font-medium transition-colors ${
                            selected
                              ? method === 'standard'
                                ? 'border-gray-400 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                                : 'border-amber-500 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
                              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                        >
                          {shippingMethodLabel(method)}
                        </button>
                      )
                    })}
                  </div>
                  {(part.shippingMethod ?? 'standard') !== 'standard' && (
                    <input
                      type="text"
                      value={part.shippingNote ?? ''}
                      onChange={(e) => {
                        setParts((prev) => {
                          const u = [...prev]
                          u[i] = { ...u[i], shippingNote: e.target.value }
                          return u
                        })
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                      maxLength={SHIPPING_NOTE_MAX_LEN}
                      placeholder="Shipping note, e.g. customer's UPS account, must land before Friday (optional)"
                      className="mt-2 w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  )}
                </div>
              )}

              {/* Free-text detail — shown for catch-all items (products.requires_detail,
                  e.g. SHOP SUPPLIES). Optional. requiresDetail || detail so a previously
                  saved detail still renders on reload even if the flag round-trips falsy. */}
              {(part.requiresDetail || part.detail) && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Details</label>
                  <input
                    type="text"
                    value={part.detail ?? ''}
                    onChange={(e) => {
                      setParts((prev) => {
                        const u = [...prev]
                        u[i] = { ...u[i], detail: e.target.value }
                        return u
                      })
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                    placeholder="Describe the items, e.g. rags, lubricant, fasteners (optional)"
                    className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setParts((prev) => [...prev, emptyPart()])}
        className="text-sm font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white py-2 min-h-[44px] flex items-center"
      >
        + Add Part
      </button>
    </div>
  )
}
