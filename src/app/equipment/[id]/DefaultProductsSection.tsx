'use client'

import { useState, useEffect, useRef } from 'react'
import { DefaultProduct } from '@/types/database'
import { useProductSearch, type ProductSearchResult } from '@/lib/hooks/useProductSearch'
import { Plus, Minus, Trash2 } from 'lucide-react'

interface DefaultProductsSectionProps {
  equipmentId: string
  initialProducts: DefaultProduct[]
}

export default function DefaultProductsSection({
  equipmentId,
  initialProducts,
}: DefaultProductsSectionProps) {
  const [products, setProducts] = useState<DefaultProduct[]>(initialProducts)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Product search state (shared hook — see src/lib/hooks/useProductSearch.ts)
  const {
    query: search,
    setQuery: setSearch,
    results,
    loading: searching,
    comboOpen,
    setComboOpen,
    clear: clearSearch,
  } = useProductSearch()
  const comboRef = useRef<HTMLDivElement>(null)

  const hasChanges = JSON.stringify(products) !== JSON.stringify(initialProducts)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [setComboOpen])

  function selectProduct(p: ProductSearchResult) {
    // synergy_product_id must hold Number(products.synergy_id) so the billing/work-order
    // PDF lookup (which queries products.synergy_id) resolves the product number.
    const id = Number(p.synergy_id)
    if (products.some((dp) => dp.synergy_product_id === id || dp.synergy_product_id === p.id)) {
      clearSearch()
      return
    }
    setProducts((prev) => [
      ...prev,
      {
        synergy_product_id: id,
        quantity: 1,
        description: `${p.number} - ${p.description ?? ''}`.trim(),
      },
    ])
    clearSearch()
    setSaved(false)
  }

  function updateQuantity(idx: number, delta: number) {
    setProducts((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, quantity: Math.max(1, p.quantity + delta) } : p
      )
    )
    setSaved(false)
  }

  function removeProduct(idx: number) {
    setProducts((prev) => prev.filter((_, i) => i !== idx))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)

    // Server-side validation enforces quantity > 0 and synergy_product_id
    // presence on each entry.
    const res = await fetch(`/api/equipment/${equipmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_products: products }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data?.error || 'Failed to save default products.')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setSaving(false)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
          Default Products
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Automatically included on every PM ticket at no charge
        </p>
      </div>

      <div className="p-5 space-y-4">
        {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

        {/* Product list */}
        {products.length > 0 && (
          <div className="space-y-2">
            {products.map((dp, idx) => (
              <div
                key={dp.synergy_product_id}
                className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2 text-sm"
              >
                <span className="flex-1 text-gray-900 dark:text-white truncate">{dp.description}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(idx, -1)}
                  className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="text-gray-700 dark:text-gray-200 font-medium w-6 text-center">{dp.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(idx, 1)}
                  className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeProduct(idx)}
                  className="p-1 text-red-400 dark:text-red-400 hover:text-red-600 ml-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {products.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No default products configured.</p>
        )}

        {/* Search to add */}
        <div ref={comboRef} className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => { if (results.length > 0) setComboOpen(true) }}
            placeholder="Search products by number or description..."
            autoComplete="off"
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          {searching && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Searching...</p>
          )}
          {comboOpen && results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-48 overflow-auto text-sm">
              {results.map((p) => (
                <li
                  key={p.id}
                  onMouseDown={() => selectProduct(p)}
                  className="px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700"
                >
                  <span className="font-medium text-gray-900">{p.number}</span>
                  {p.description && (
                    <span className="text-gray-500 dark:text-gray-400 ml-2">{p.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {comboOpen && !searching && search.trim() && results.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No products found.</p>
          )}
        </div>

        {/* Save button */}
        {hasChanges && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Products'}
            </button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          </div>
        )}
      </div>
    </div>
  )
}
