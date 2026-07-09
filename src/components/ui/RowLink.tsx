'use client'

import Link from 'next/link'

export interface RowLinkProps {
  href: string
  /** Accessible name for the row's destination — screen readers announce this instead of the row's raw text, since the link itself renders no visible content. */
  label: string
  className?: string
}

/**
 * A full-bleed navigation target for a table row or card. Renders a single
 * `<Link>`, absolutely positioned (`inset-0`) so it fills its nearest
 * `position: relative` ancestor — typically `<tr className="relative">` for a
 * `DataTable`-less table, or a `relative` wrapper `<div>` for a card — making
 * the entire row a click, ctrl/cmd-click, middle-click, and keyboard (Tab +
 * Enter) target with a visible focus ring, while the row's real cell/card
 * content renders in normal flow on top of it.
 *
 * Drop `<RowLink>` inside the row's primary cell (it doesn't need to be the
 * first or only child); it does not need to visually anchor there since it
 * stretches to the row's own bounds. Anything in the row that must stay
 * independently interactive — checkboxes, buttons, an inline editor, a
 * copyable ID the user wants to select — needs its own `relative z-10` (or
 * higher) so it paints above this link and captures its own clicks/selection
 * instead of triggering navigation.
 */
export default function RowLink({ href, label, className = '' }: RowLinkProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`absolute inset-0 z-0 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 ${className}`}
    >
      <span className="sr-only">{label}</span>
    </Link>
  )
}
