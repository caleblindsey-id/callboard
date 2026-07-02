'use client'

// Shared presentational helpers for the service ticket detail page and its
// extracted section components (audit P3 refactor). Defined outside the main
// component so React never remounts them on a parent re-render.

import { useState } from 'react'

export const billingTypeLabels: Record<string, string> = {
  non_warranty: 'Non-Warranty',
  warranty: 'Warranty',
  partial_warranty: 'Partial Warranty',
}

export function Badge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 ${className}`}>
      {title && (
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">
            {title}
          </h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

export function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-gray-500 dark:text-gray-400 text-sm">{label}</span>
      <p className="text-gray-900 dark:text-white font-medium text-sm">{children}</p>
    </div>
  )
}

// ── Section accordion wrapper ──────────────────────────────────────────────
// Uses uncontrolled <details> with a key so changes to `open` re-render the
// element rather than fighting the browser's internal state. The `title` is
// rendered as an h2 inside the <summary> so the section keeps its visual
// hierarchy when collapsed.
export function CardSection({
  title,
  open,
  summarySuffix,
  children,
}: {
  title: string
  open: boolean
  summarySuffix?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <details key={open ? 'open' : 'closed'} open={open}>
        <summary className="px-5 py-4 cursor-pointer select-none flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 marker:content-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide truncate">
              {title}
            </h2>
            {summarySuffix && <span className="shrink-0">{summarySuffix}</span>}
          </div>
          <svg className="h-4 w-4 text-gray-400 dark:text-gray-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className="p-5">{children}</div>
      </details>
    </div>
  )
}

// Single Synergy number field with a Save button. Used in two contexts on a
// service ticket: the parts-ordering order # (default labels) and the billing
// invoice # (override the heading/fieldLabel). They write to different columns,
// so each instance gets its own initial value and onSave handler.
export function SynergyNumberField({
  initialValue,
  onSave,
  loading,
  heading = 'Synergy Ordering',
  fieldLabel = 'Order #',
}: {
  initialValue: string
  onSave: (value: string) => Promise<void>
  loading: boolean
  heading?: string
  fieldLabel?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [dirty, setDirty] = useState(false)

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wide">{heading}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{fieldLabel}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setDirty(true) }}
            className="rounded-md border border-gray-300 dark:bg-gray-700 dark:text-white dark:border-gray-600 px-3 py-3 sm:py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>
        {dirty && (
          <button
            onClick={() => { onSave(value); setDirty(false) }}
            disabled={loading}
            className="self-end px-4 py-3 sm:py-2 text-sm font-medium text-white bg-slate-600 rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            Save
          </button>
        )}
      </div>
    </div>
  )
}
