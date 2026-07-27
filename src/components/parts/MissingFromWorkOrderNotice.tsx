'use client'

import { useState } from 'react'
import { partLabel } from '@/lib/parts'
import type { PartRequest } from '@/types/database'

export type MissingPartItem = {
  part: PartRequest
  /** Position in the parent ticket's parts_requested array. */
  index: number
}

interface MissingFromWorkOrderNoticeProps {
  items: MissingPartItem[]
  /**
   * Copy every listed part onto the work order. Omit for read-only contexts
   * (completed / billed views), where the notice is informational only.
   */
  onAdd?: () => void
  /**
   * Record that a fulfilled part was deliberately NOT used, with the reason.
   * Omit alongside onAdd for read-only contexts.
   */
  onExclude?: (index: number, reason: string) => Promise<void> | void
  busy?: boolean
}

/**
 * Warns that parts the branch actually bought or pulled are missing from the
 * work order.
 *
 * The underlying problem: `parts_requested` (procurement) and `parts_used`
 * (the billable work order) are separate JSONB arrays, and only the latter
 * reaches billing, the work-order PDF, and the billing export. A part could be
 * requested, PO'd, received and physically collected while being worth $0 on
 * the invoice. Parts are now auto-added on fulfillment, so this notice is the
 * safety net for the cases the auto-add can't cover: parts fulfilled before
 * that shipped, lines a tech deleted, and the race where a completion form left
 * open overwrites the array with its own stale copy.
 *
 * Deliberately does NOT block completion. Techs finish jobs in the field on a
 * phone, and a hard gate on a heuristic match would strand them on a customer
 * site over a part that is already billed under a different description. The
 * office-side reconciliation report is the backstop for anything dismissed here.
 */
export default function MissingFromWorkOrderNotice({
  items,
  onAdd,
  onExclude,
  busy = false,
}: MissingFromWorkOrderNoticeProps) {
  const [excludingIndex, setExcludingIndex] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (items.length === 0) return null

  const interactive = !!onAdd || !!onExclude
  const disabled = busy || submitting

  async function confirmExclude(index: number) {
    const trimmed = reason.trim()
    if (!onExclude || trimmed.length < 2) return
    setSubmitting(true)
    try {
      await onExclude(index, trimmed)
      setExcludingIndex(null)
      setReason('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <svg
          className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {items.length === 1
              ? '1 fulfilled part is not on this work order'
              : `${items.length} fulfilled parts are not on this work order`}
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            {interactive
              ? 'These were received or pulled from stock. If they were used on this job, add them so they get billed.'
              : 'These were received or pulled from stock but never added to the work order, so they were not billed.'}
          </p>

          <ul className="mt-2 space-y-1.5">
            {items.map(({ part, index }) => {
              const price = typeof part.unit_price === 'number' ? part.unit_price : 0
              return (
                <li key={`${part.requested_at ?? 'legacy'}-${index}`} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-amber-900 dark:text-amber-200">
                    {part.product_number && (
                      <span className="font-mono text-xs">{part.product_number}</span>
                    )}
                    <span className="font-medium">{partLabel(part)}</span>
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      x{part.quantity}
                      {price > 0 ? ` · $${price.toFixed(2)}` : ''}
                    </span>
                  </div>

                  {onExclude && excludingIndex === index && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Why wasn't it used? (e.g. wrong part, went back on the shelf)"
                        className="min-w-0 flex-1 rounded-md border border-amber-300 dark:border-amber-700 dark:bg-gray-700 dark:text-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => confirmExclude(index)}
                        disabled={disabled || reason.trim().length < 2}
                        className="min-h-[44px] sm:min-h-0 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setExcludingIndex(null)
                          setReason('')
                        }}
                        disabled={disabled}
                        className="min-h-[44px] sm:min-h-0 px-2 py-2 text-sm text-amber-800 dark:text-amber-300 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {interactive && excludingIndex === null && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onAdd && (
                <button
                  type="button"
                  onClick={onAdd}
                  disabled={disabled}
                  className="min-h-[44px] sm:min-h-0 rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {items.length === 1 ? 'Add to work order' : `Add all ${items.length} to work order`}
                </button>
              )}
              {onExclude &&
                items.map(({ part, index }) => (
                  <button
                    key={`exclude-${part.requested_at ?? 'legacy'}-${index}`}
                    type="button"
                    onClick={() => {
                      setExcludingIndex(index)
                      setReason('')
                    }}
                    disabled={disabled}
                    className="min-h-[44px] sm:min-h-0 rounded-md border border-amber-400 dark:border-amber-600 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 transition-colors"
                  >
                    {items.length === 1
                      ? 'Not used'
                      : `Not used: ${partLabel(part).slice(0, 24)}`}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
