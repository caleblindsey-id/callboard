'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sanitizeOrValue, safeOrRaw } from '@/lib/db/safe-or'
import { shouldSearchProducts } from '@/lib/products-search'
import { Check, Pencil } from 'lucide-react'

interface ProductSearchResult {
  id: number
  synergy_id: string
  number: string
  description: string | null
}

interface PartSynergyPickerProps {
  productNumber?: string
  synergyProductId?: number | null
  onChange: (next: { product_number: string; synergy_product_id: number | null }) => void
  disabled?: boolean
  placeholder?: string
}

export default function PartSynergyPicker({
  productNumber,
  synergyProductId,
  onChange,
  disabled = false,
  placeholder = 'Search Synergy item # or description',
}: PartSynergyPickerProps) {
  const [search, setSearch] = useState(productNumber ?? '')
  const [results, setResults] = useState<ProductSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [editing, setEditing] = useState(!productNumber)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const hasCatalogMatch = !!synergyProductId

  // Debounced product search — fires asynchronously so setState inside the callback
  // doesn't trigger the react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (!editing) return
    // Sanitize before splicing into .or() — see lib/db/safe-or. Previously
    // this call site missed sanitization entirely.
    if (!shouldSearchProducts(search)) return
    const q = sanitizeOrValue(search.trim())
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('products')
        .select('id, synergy_id, number, description')
        .or(safeOrRaw([
          { column: 'number', op: 'ilike', raw: `%${q}%` },
          { column: 'description', op: 'ilike', raw: `%${q}%` },
        ]))
        .order('number')
        .limit(10)
      setResults((data as ProductSearchResult[]) ?? [])
      setOpen(true)
      setSearching(false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, editing])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectMatch(p: ProductSearchResult) {
    const synergyId = Number(p.synergy_id)
    onChange({
      product_number: p.number,
      synergy_product_id: Number.isFinite(synergyId) ? synergyId : null,
    })
    setSearch(p.number)
    setOpen(false)
    setEditing(false)
  }

  function useAsIs() {
    const raw = search.trim()
    if (!raw) return
    onChange({ product_number: raw, synergy_product_id: null })
    setOpen(false)
    setEditing(false)
  }

  function startEditing() {
    setEditing(true)
    setSearch(productNumber ?? '')
    setTimeout(() => {
      const el = containerRef.current?.querySelector('input')
      if (el) (el as HTMLInputElement).focus()
    }, 0)
  }

  // Collapsed view when a value is set and not editing
  if (!editing && productNumber) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          <span className="text-gray-500 dark:text-gray-400 shrink-0">Synergy item #:</span>
          <span className="font-mono font-medium text-gray-900 dark:text-white">{productNumber}</span>
          {hasCatalogMatch ? (
            <span
              title="Matched in Synergy product catalog"
              className="inline-flex items-center gap-0.5 text-green-700 dark:text-green-400"
            >
              <Check className="h-3 w-3" />
              <span className="text-[10px] uppercase tracking-wide">catalog</span>
            </span>
          ) : (
            <span
              title="Free-text entry — not matched in catalog"
              className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
            >
              manual
            </span>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={startEditing}
            title="Edit Synergy item #"
            className="p-1 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300 transition-colors rounded"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
        Synergy item #
      </label>
      <input
        type="text"
        value={search}
        onChange={e => {
          const v = e.target.value
          setSearch(v)
          if (!v.trim()) {
            setResults([])
            setOpen(false)
          } else {
            setOpen(true)
          }
        }}
        onFocus={() => { if (search.trim()) setOpen(true) }}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-500 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
      />
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto">
          {searching && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Searching…</div>
          )}
          {!searching && results.length === 0 && search.trim() && (
            <button
              type="button"
              onClick={useAsIs}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              No catalog match. Use &quot;<span className="font-mono">{search.trim()}</span>&quot; anyway.
            </button>
          )}
          {!searching && results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectMatch(p)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
            >
              <span className="font-mono text-gray-900 dark:text-white">{p.number}</span>
              {p.description && (
                <span className="text-gray-500 dark:text-gray-400"> — {p.description}</span>
              )}
            </button>
          ))}
          {!searching && results.length > 0 && (
            <button
              type="button"
              onClick={useAsIs}
              className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-100 dark:border-gray-700"
            >
              Or use &quot;<span className="font-mono">{search.trim()}</span>&quot; as-is (no catalog match)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
