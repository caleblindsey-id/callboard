'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'

// ── Types (shared with ServiceTicketDetail) ──

export interface ProductResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
  unit_price: number | null
}

export interface PartEntry {
  description: string
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
  searchOpen: boolean
  searchResults: ProductResult[]
  searching: boolean
  warrantyCovered: boolean
  // Optional manufacturer / vendor part number. Only surfaced when the parent
  // opts in via showVendorItemCode (PM ticket parts requests use this).
  vendorItemCode?: string | null
  // Local flag flipped after the row has been sent to the parts-requested
  // queue via onRequestPart. Not persisted.
  alreadyRequested?: boolean
}

export function emptyPart(): PartEntry {
  return {
    description: '',
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
  }
}

export function partsFromSaved(saved: { synergy_product_id?: number | null; description: string; quantity: number; unit_price: number; warranty_covered?: boolean }[]): PartEntry[] {
  return saved.map((p) => ({
    description: p.description,
    quantity: String(p.quantity),
    unitPrice: String(p.unit_price),
    synergyProductId: p.synergy_product_id ?? null,
    productNumber: null,
    isFromDb: p.synergy_product_id != null,
    searchOpen: false,
    searchResults: [],
    searching: false,
    warrantyCovered: p.warranty_covered ?? false,
  }))
}

export function toServicePartUsed(entries: PartEntry[]): { synergy_product_id: number | null; description: string; quantity: number; unit_price: number; warranty_covered: boolean }[] {
  return entries.map((p) => ({
    synergy_product_id: p.synergyProductId ? Number(p.synergyProductId) : null,
    description: p.description,
    quantity: parseFloat(p.quantity) || 0,
    unit_price: parseFloat(p.unitPrice) || 0,
    warranty_covered: p.warrantyCovered,
  }))
}

// ── Component ──

interface PartsEntryListProps {
  parts: PartEntry[]
  setParts: React.Dispatch<React.SetStateAction<PartEntry[]>>
  showPricing: boolean
  showWarranty: boolean
  label?: string
  // Surface an optional vendor / manufacturer part # input on each row.
  showVendorItemCode?: boolean
  // When provided, each row renders a "Request" button that hands the entry
  // off to the caller (which creates a PartRequest on the ticket). The caller
  // is responsible for flipping `alreadyRequested` on success.
  onRequestPart?: (index: number) => Promise<void>
}

export default function PartsEntryList({ parts, setParts, showPricing, showWarranty, label = 'Parts', showVendorItemCode = false, onRequestPart }: PartsEntryListProps) {
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
      updated[index] = { ...updated[index], description: value, isFromDb: false, synergyProductId: null, productNumber: null }
      return updated
    })

    const existing = debounceRefs.current.get(index)
    if (existing) clearTimeout(existing)

    if (!value.trim()) {
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
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description, unit_price')
        .or(safeOrRaw([
          { column: 'number', op: 'ilike', raw: `%${q}%` },
          { column: 'description', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('number')
        .limit(10)

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
      // Reset keyboard focus whenever new results arrive
      clearFocus(index)
    }, 300))
  }

  function handleSelectProduct(index: number, product: ProductResult) {
    setParts((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        description: `${product.number} - ${product.description ?? ''}`,
        unitPrice: String(product.unit_price ?? 0),
        synergyProductId: Number(product.synergy_id),
        productNumber: product.number,
        isFromDb: true,
        searchOpen: false,
        searchResults: [],
      }
      return updated
    })
    clearFocus(index)
  }

  function handleClearProduct(index: number) {
    setParts((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], description: '', unitPrice: '', synergyProductId: null, productNumber: null, isFromDb: false }
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
                  <div className="flex items-center gap-1 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-3 h-[44px] sm:h-[34px] text-sm text-gray-900 dark:text-white">
                    <span className="flex-1 truncate">{part.description}</span>
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
                    {part.searchResults.map((product, ri) => (
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
                        <span className="text-gray-500 dark:text-gray-400"> — {product.description ?? ''}</span>
                        {product.unit_price != null && (
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
                {showPricing && (
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
                      readOnly={part.isFromDb}
                      className={`w-24 rounded-md border px-2 h-[44px] sm:h-[34px] text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-500 ${
                        part.isFromDb ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 cursor-not-allowed dark:text-white' : 'border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600'
                      }`}
                    />
                  </div>
                )}
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
                      placeholder="optional"
                      className="w-32 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 h-[44px] sm:h-[34px] text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    />
                  </div>
                )}
                {onRequestPart && (
                  part.alreadyRequested ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400 px-2 min-h-[44px] sm:min-h-0">
                      ✓ Requested
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={!part.description.trim()}
                      onClick={() => onRequestPart(i)}
                      title={!part.description.trim() ? 'Add a part description first' : 'Request this part to be ordered'}
                      className="ml-auto px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 transition-colors"
                    >
                      Request
                    </button>
                  )
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
