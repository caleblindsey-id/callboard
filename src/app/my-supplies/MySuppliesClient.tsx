'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Minus, X, Check, Trash2, SprayCan } from 'lucide-react'
import type { SupplyCatalogRow, SupplyRequestRow } from '@/types/database'
import InlineError from '@/components/ui/InlineError'
import EmptyState, { emptyCopy } from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'

type Props = {
  catalog: SupplyCatalogRow[]
  requests: SupplyRequestRow[]
}

type CartLine = {
  key: string          // catalog id, or "free:<n>" for typed items
  name: string
  unit: string | null
  quantity: number
  catalog_id: string | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function MySuppliesClient({ catalog, requests }: Props) {
  const router = useRouter()
  const [cart, setCart] = useState<CartLine[]>([])
  const [otherName, setOtherName] = useState('')
  const [note, setNote] = useState('')
  const [freeSeq, setFreeSeq] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelingId, setCancelingId] = useState<string | null>(null)

  const cartByKey = useMemo(() => new Map(cart.map((c) => [c.key, c])), [cart])

  function addCatalogItem(item: SupplyCatalogRow) {
    setError(null)
    setCart((prev) => {
      const existing = prev.find((c) => c.key === item.id)
      if (existing) {
        return prev.map((c) => (c.key === item.id ? { ...c, quantity: c.quantity + 1 } : c))
      }
      return [...prev, { key: item.id, name: item.name, unit: item.unit, quantity: 1, catalog_id: item.id }]
    })
  }

  function addOther() {
    const name = otherName.trim()
    if (!name) return
    const key = `free:${freeSeq}`
    setFreeSeq((n) => n + 1)
    setCart((prev) => [...prev, { key, name, unit: null, quantity: 1, catalog_id: null }])
    setOtherName('')
    setError(null)
  }

  function setQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0),
    )
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key))
  }

  async function submit() {
    if (cart.length === 0) {
      setError('Add at least one item to request.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/supply-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((c) => ({ name: c.name, quantity: c.quantity, catalog_id: c.catalog_id, unit: c.unit })),
          note: note.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error || 'Failed to submit request')
      }
      setCart([])
      setNote('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelRequest(id: string) {
    setCancelingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/supply-requests/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.error || 'Failed to cancel')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel')
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* ---------- Request form ---------- */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sm:p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">New request</h2>

        {/* Quick-pick chips */}
        {catalog.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {catalog.map((item) => {
              const inCart = cartByKey.has(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addCatalogItem(item)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium min-h-[44px] sm:min-h-0 border transition-colors ${
                    inCart
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {item.name}
                  {item.unit && <span className="text-xs opacity-70">({item.unit})</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Free-text other */}
        <div className="flex gap-2">
          <input
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOther() } }}
            placeholder="Other item not listed…"
            className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400"
          />
          <button
            type="button"
            onClick={addOther}
            disabled={!otherName.trim()}
            className="px-3 py-2 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-3">
            {cart.map((line) => (
              <div key={line.key} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-900 dark:text-white">{line.name}</span>
                  {line.unit && <span className="ml-1 text-xs text-gray-400">({line.unit})</span>}
                </div>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setQty(line.key, -1)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    aria-label={`Decrease ${line.name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums text-gray-900 dark:text-white">{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQty(line.key, 1)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    aria-label={`Increase ${line.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  className="text-gray-400 hover:text-red-500"
                  aria-label={`Remove ${line.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the office (optional)"
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
        )}

        {error && <InlineError message={error} />}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || cart.length === 0}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 min-h-[44px] sm:min-h-0"
        >
          <Check className="h-4 w-4" />
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </section>

      {/* ---------- My requests ---------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">My requests</h2>
        {requests.length === 0 ? (
          <EmptyState icon={SprayCan} message={emptyCopy('supply requests', false)} />
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => {
              return (
                <li
                  key={r.id}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Badge domain="supply" status={r.status} />
                      <span className="ml-2 text-xs text-gray-400">{fmtDate(r.created_at)}</span>
                    </div>
                    {r.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => cancelRequest(r.id)}
                        disabled={cancelingId === r.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {cancelingId === r.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </div>
                  <ul className="mt-2 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                    {r.items.map((it, i) => (
                      <li key={i}>
                        <span className={it.denied ? 'line-through text-gray-400 dark:text-gray-500' : ''}>
                          {it.name}
                          <span className="text-gray-400"> × {it.quantity}{it.unit ? ` ${it.unit}` : ''}</span>
                        </span>
                        {it.denied && (
                          <span className="ml-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                            denied{it.denied_reason ? `: ${it.denied_reason}` : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {r.note && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">{r.note}</p>}
                  {r.status === 'denied' && r.denied_reason && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">Denied: {r.denied_reason}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
