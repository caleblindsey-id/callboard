'use client'

import { useEffect, useState } from 'react'
import { canEditPartQuantity, normalizePartQuantity } from '@/lib/parts'

/**
 * The quantity on a requested part, editable in place while the part is still a
 * request and rendered as plain text once it is not.
 *
 * Shared by the service (PartsSection) and PM (PmPartsSection) work-order views.
 * One component rather than a copy in each: the two ticket types have drifted
 * every previous time a parts affordance was built twice (the from_stock
 * waiting-count bug, the two soft-cancel paths that each forgot the terminal
 * status). The edit window itself lives in canEditPartQuantity, which the two
 * server routes enforce independently — this only decides what to draw.
 *
 * Commit is on blur, and a rejected value stays in the box so the user can fix
 * it rather than watching their typing vanish (feedback #34).
 */
export default function PartQuantityField({
  part,
  disabled,
  onSave,
}: {
  part: { quantity: number; status?: string | null; cancelled?: boolean | null }
  disabled: boolean
  onSave: (quantity: number) => Promise<void>
}) {
  const [local, setLocal] = useState(String(part.quantity))
  const [focused, setFocused] = useState(false)
  const [lastExternal, setLastExternal] = useState(part.quantity)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Never yank the field out from under someone mid-edit; take the server's
  // value only while the input is idle.
  if (part.quantity !== lastExternal) {
    setLastExternal(part.quantity)
    if (!focused) setLocal(String(part.quantity))
  }

  useEffect(() => {
    if (!saved) return
    const id = window.setTimeout(() => setSaved(false), 1500)
    return () => window.clearTimeout(id)
  }, [saved])

  if (!canEditPartQuantity(part)) {
    return <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">x{part.quantity}</span>
  }

  async function commit() {
    setFocused(false)
    const parsed = normalizePartQuantity(local)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    if (parsed.value === part.quantity) {
      setError(null)
      return
    }
    setError(null)
    try {
      await onSave(parsed.value)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the quantity.')
    }
  }

  return (
    <span className="inline-flex items-center gap-1 ml-2 align-middle">
      <span className="text-sm text-gray-500 dark:text-gray-400">x</span>
      <input
        type="number"
        step="1"
        min="1"
        inputMode="numeric"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value)
          if (error) setError(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={commit}
        disabled={disabled}
        aria-invalid={!!error}
        aria-label="Quantity"
        title="Quantity requested"
        className={`w-14 rounded-md border ${
          error ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
        } dark:bg-gray-700 dark:text-white px-1.5 py-0.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50`}
      />
      {saved && !error && (
        <span className="text-xs text-green-600 dark:text-green-400">saved</span>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  )
}
