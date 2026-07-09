'use client'

import { useEffect, useState } from 'react'
import { Check, X as XIcon } from 'lucide-react'

// Shared click-to-edit cell for the four near-identical single-field editors
// (PO #, Synergy Order #, Synergy Invoice #) that were hand-copied across
// BillingExport, PmAwaitingInvoice, ServiceBillingExport, and
// ServiceAwaitingInvoice (billing-6). Behavior is preserved exactly per field —
// this component only owns the edit/view toggle, the input, and the
// Save/Cancel affordance; each caller still owns its own PATCH endpoint,
// validation, and toast.

export type InlineEditCellProps = {
  /** Current field value, or null/empty when unset. */
  value: string | null
  /** Input placeholder shown while editing. */
  placeholder: string
  /**
   * Persists the new value. Throw to signal failure — the cell shows a brief
   * inline fail tick and stays in edit mode (the caller's own toast still
   * carries the error message; nothing about that changes).
   */
  onSave: (value: string) => Promise<void>
  /**
   * 'pill' = red required-and-missing badge (e.g. "PO Needed").
   * 'ghost' = subtle "+ Label" link for an optional field (e.g. "+ Synergy Order #").
   */
  emptyVariant: 'pill' | 'ghost'
  /** Text shown in the empty-state affordance. */
  emptyText: string
  /** Tailwind color classes for the displayed (non-empty) value text. */
  valueClassName?: string
  /** Tailwind width class for the edit input. */
  inputWidthClassName?: string
  /** Tailwind max-width class for the truncated displayed value. */
  valueMaxWidthClassName?: string
  /**
   * When true, a set value renders as a plain (non-clickable) span instead of
   * a re-editable button — mirrors the PO Status field's original behavior,
   * which only offers an edit affordance while the PO is missing.
   */
  readOnlyWhenSet?: boolean
  /**
   * Fired whenever this cell's own edit mode opens/closes. Callers use it to
   * keep a row from dimming (the original "don't gray out the row I'm
   * actively editing" behavior) without each cell needing to know about the
   * others on the same row.
   */
  onEditingChange?: (editing: boolean) => void
}

export default function InlineEditCell({
  value,
  placeholder,
  onSave,
  emptyVariant,
  emptyText,
  valueClassName = 'text-gray-700 dark:text-gray-300',
  inputWidthClassName = 'w-28',
  valueMaxWidthClassName = 'max-w-[140px]',
  readOnlyWhenSet = false,
  onEditingChange,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState<'saved' | 'failed' | null>(null)

  // Let a transient tick fade on its own rather than linger indefinitely.
  useEffect(() => {
    if (!tick) return
    const timer = setTimeout(() => setTick(null), 1800)
    return () => clearTimeout(timer)
  }, [tick])

  function startEdit() {
    setDraft(value ?? '')
    setTick(null)
    setEditing(true)
    onEditingChange?.(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft('')
    onEditingChange?.(false)
  }

  async function handleSave() {
    const trimmed = draft.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onSave(trimmed)
      setEditing(false)
      setDraft('')
      setTick('saved')
      onEditingChange?.(false)
    } catch {
      // Keep editing open so the typed value isn't lost — the caller's toast
      // already carries the error message; this tick is just the glance-level signal.
      setTick('failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') cancelEdit()
          }}
          placeholder={placeholder}
          autoFocus
          disabled={saving}
          className={`${inputWidthClassName} rounded border border-gray-300 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-900 dark:text-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-slate-500`}
        />
        <button
          onClick={handleSave}
          disabled={saving || !draft.trim()}
          className="px-1.5 py-0.5 text-xs font-medium text-white bg-slate-700 rounded hover:bg-slate-600 disabled:opacity-50"
        >
          {saving ? '...' : 'Save'}
        </button>
        <button
          onClick={cancelEdit}
          disabled={saving}
          className="px-1.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          Cancel
        </button>
        {tick === 'failed' && (
          <XIcon className="h-3.5 w-3.5 text-red-500 shrink-0" aria-label="Save failed" />
        )}
      </div>
    )
  }

  if (value) {
    if (readOnlyWhenSet) {
      return (
        <span
          className={`truncate ${valueMaxWidthClassName} inline-block align-bottom ${valueClassName}`}
          title={value}
        >
          {value}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); startEdit() }}
          title={`${value} — click to edit`}
          className={`truncate ${valueMaxWidthClassName} inline-block align-bottom hover:underline ${valueClassName}`}
        >
          {value}
        </button>
        {tick === 'saved' && (
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" aria-label="Saved" />
        )}
      </span>
    )
  }

  if (emptyVariant === 'pill') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); startEdit() }}
        className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
      >
        {emptyText}
      </button>
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); startEdit() }}
      className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:underline"
    >
      {emptyText}
    </button>
  )
}
