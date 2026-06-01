import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import type { PartEntry, ProductResult } from './TicketActions'

// ──────────────────────────────────────────────
// Parts list rendering + handlers
//
// Extracted from TicketActions.tsx (QC Phase 2 R4 / TKT-6).
// IMPORTANT: This is a plain render function — NOT a React sub-component.
// Per the "no-inner-components" rule, sub-components defined inside a
// parent cause input focus loss on re-render. A function called inline
// with the parent's local state/refs avoids that risk.
// ──────────────────────────────────────────────

export function emptyPart(): PartEntry {
  return {
    description: '',
    quantity: '1',
    unitPrice: '',
    synergyProductId: null,
    isFromDb: false,
    searchOpen: false,
    searchResults: [],
    searching: false,
  }
}

function handlePartSearch(
  index: number,
  value: string,
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
  debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>
) {
  setter((prev) => {
    const updated = [...prev]
    updated[index] = { ...updated[index], description: value, isFromDb: false, synergyProductId: null, requiresDetail: false }
    return updated
  })

  const existing = debounceMap.current.get(index)
  if (existing) clearTimeout(existing)

  if (!value.trim()) {
    setter((prev) => {
      const updated = [...prev]
      if (updated[index]) {
        updated[index] = { ...updated[index], searchOpen: false, searchResults: [] }
      }
      return updated
    })
    return
  }

  debounceMap.current.set(index, setTimeout(async () => {
    setter((prev) => {
      const u = [...prev]
      if (u[index]) u[index] = { ...u[index], searching: true }
      return u
    })

    const supabase = createClient()
    // Sanitize before splicing into .or() — see lib/db/safe-or. Previously
    // this call site missed sanitization entirely.
    const q = sanitizeOrValue(value.trim())
    const { data } = await supabase
      .from('products')
      .select('id, synergy_id, number, description, unit_price, requires_detail')
      .or(safeOrRaw([
        { column: 'number', op: 'ilike', raw: `%${q}%` },
        { column: 'description', op: 'ilike', raw: `%${q}%` },
      ]))
      .order('number')
      .limit(25)

    setter((prev) => {
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

function handleSelectProduct(
  index: number,
  product: ProductResult,
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
  zeroPrices: boolean
) {
  setter((prev) => {
    const updated = [...prev]
    updated[index] = {
      ...updated[index],
      description: `${product.number} - ${product.description ?? ''}`,
      unitPrice: zeroPrices ? '0' : String(product.unit_price ?? 0),
      synergyProductId: Number(product.synergy_id),
      isFromDb: true,
      requiresDetail: !!product.requires_detail,
      searchOpen: false,
      searchResults: [],
    }
    return updated
  })
}

function handleClearProduct(
  index: number,
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>
) {
  setter((prev) => {
    const updated = [...prev]
    updated[index] = { ...updated[index], description: '', unitPrice: '', synergyProductId: null, isFromDb: false, requiresDetail: false, detail: '' }
    return updated
  })
}

function handleUpdatePartField(
  index: number,
  field: 'quantity' | 'unitPrice' | 'detail',
  value: string,
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>
) {
  // Store the raw input string so the field can be empty (no stray leading
  // "0"); parsed with parseFloat at the use sites. Mirrors hoursWorked.
  setter((prev) => {
    const updated = [...prev]
    updated[index] = { ...updated[index], [field]: value }
    return updated
  })
}

function handleRemovePart(
  index: number,
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>,
  debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>,
  comboMap: React.MutableRefObject<Map<number, HTMLDivElement | null>>
) {
  setter((prev) => prev.filter((_, i) => i !== index))
  debounceMap.current.delete(index)
  comboMap.current.delete(index)
}

export interface RenderPartsSectionProps {
  parts: PartEntry[]
  setter: React.Dispatch<React.SetStateAction<PartEntry[]>>
  debounceMap: React.MutableRefObject<Map<number, ReturnType<typeof setTimeout>>>
  comboMap: React.MutableRefObject<Map<number, HTMLDivElement | null>>
  options: { showPrices: boolean; zeroPricesOnSelect: boolean; keyPrefix: string }
}

export function renderPartsSection({
  parts,
  setter,
  debounceMap,
  comboMap,
  options,
}: RenderPartsSectionProps) {
  return (
    <>
      {parts.length > 0 && (
        <div className="space-y-2">
          {parts.map((part, i) => (
            <div key={`${options.keyPrefix}-${i}`} className="rounded-md border border-gray-200 p-3 space-y-2 sm:border-0 sm:p-0 sm:space-y-0 sm:grid sm:items-center sm:gap-2" style={{ gridTemplateColumns: options.showPrices ? '1fr 56px 72px 72px auto' : '1fr 56px auto' }}>
              {/* Description with product search */}
              <div
                className="relative min-w-0"
                ref={(el) => { comboMap.current.set(i, el) }}
              >
                {part.isFromDb ? (
                  <div className="flex items-center gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 dark:text-white">
                    <span className="flex-1 truncate">{part.description}</span>
                    <button
                      type="button"
                      onClick={() => handleClearProduct(i, setter)}
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
                    onChange={(e) => handlePartSearch(i, e.target.value, setter, debounceMap)}
                    className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                )}
                {part.searchOpen && part.searchResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {part.searchResults.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleSelectProduct(i, product, setter, options.zeroPricesOnSelect)}
                        className="w-full text-left px-3 py-3 sm:py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                      >
                        <span className="font-medium text-gray-900 dark:text-white">{product.number}</span>
                        <span className="text-gray-500 dark:text-gray-400"> — {product.description ?? ''}</span>
                        {options.showPrices && product.unit_price != null && (
                          <span className="text-green-700 dark:text-green-400 sm:float-right font-medium block sm:inline mt-0.5 sm:mt-0">
                            ${product.unit_price.toFixed(2)}
                          </span>
                        )}
                      </button>
                    ))}
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
              {/* Qty + optional Price + Remove */}
              <div className="flex items-center gap-2 sm:contents">
                <div className="flex-1 sm:contents">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5 sm:hidden">Qty</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={part.quantity}
                    onChange={(e) => handleUpdatePartField(i, 'quantity', e.target.value, setter)}
                    className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-2 h-[44px] sm:h-[34px] text-sm text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                {options.showPrices && (
                  <>
                    <div className="flex-1 sm:contents">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5 sm:hidden">Price</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Price"
                        value={part.unitPrice}
                        onChange={(e) => handleUpdatePartField(i, 'unitPrice', e.target.value, setter)}
                        readOnly={part.isFromDb}
                        className={`w-full rounded-md border px-2 h-[44px] sm:h-[34px] text-sm text-gray-900 dark:text-white text-right focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                          part.isFromDb ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 cursor-not-allowed' : 'border-gray-300 dark:bg-gray-700 dark:border-gray-600'
                        }`}
                      />
                    </div>
                    <div className="hidden sm:block text-sm text-gray-600 dark:text-gray-400 text-right tabular-nums">
                      ${((parseFloat(part.quantity) || 0) * (parseFloat(part.unitPrice) || 0)).toFixed(2)}
                    </div>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleRemovePart(i, setter, debounceMap, comboMap)}
                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 text-xs min-h-[44px] sm:min-h-0 flex items-center justify-center px-1"
                >
                  Remove
                </button>
              </div>
              {/* Free-text detail — catch-all items (products.requires_detail, e.g.
                  SHOP SUPPLIES). Spans the full grid width on desktop. */}
              {(part.requiresDetail || part.detail) && (
                <div className="sm:col-span-full">
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">Details</label>
                  <input
                    type="text"
                    value={part.detail ?? ''}
                    onChange={(e) => handleUpdatePartField(i, 'detail', e.target.value, setter)}
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
        onClick={() => setter((prev) => [...prev, emptyPart()])}
        className="text-sm font-medium text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white py-2 min-h-[44px] sm:min-h-0 flex items-center"
      >
        + Add Part
      </button>
    </>
  )
}
