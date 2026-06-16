'use client'

import { useLayoutEffect, useRef, useState } from 'react'

// Reserve a little breathing room below the table so the horizontal scrollbar
// doesn't sit flush against the bottom edge of the viewport.
const DEFAULT_BOTTOM_GAP = 24
// Never collapse the scroll region smaller than this, even on a page with a lot
// of chrome above the table — better to let the page scroll a little than to
// show a one-row-tall box.
const MIN_HEIGHT = 220

/**
 * Drop-in replacement for the `<div className="overflow-x-auto …">` wrappers
 * around our data tables.
 *
 * The old wrappers only clipped horizontally, so a tall table put its horizontal
 * scrollbar at the bottom of the *full* table height — you had to scroll the
 * whole page down to reach it (feedback #46). This wrapper instead measures its
 * own distance from the top of the viewport and caps its `max-height` so the
 * element is scroll-clipped to the visible area in *both* directions. The
 * horizontal scrollbar then rides at the bottom of the screen no matter how far
 * down the list goes.
 *
 * Measuring the offset (rather than a fixed `calc(100vh - Nrem)`) means it works
 * on every page regardless of how much chrome — headings, tabs, filter bars —
 * sits above the table.
 *
 * Pass the wrapper's non-overflow classes (border, rounding, background,
 * `hidden lg:block`, …) via `className`; this component owns the overflow.
 */
export default function ScrollableTable({
  children,
  className = '',
  bottomGap = DEFAULT_BOTTOM_GAP,
}: {
  children: React.ReactNode
  className?: string
  bottomGap?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  // undefined until measured (and whenever the table is hidden) — the element
  // then renders unconstrained, matching the pre-existing behaviour, and SSR
  // emits no inline height.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let raf = 0
    const measure = () => {
      // offsetParent is null when the element (or an ancestor) is display:none —
      // e.g. the `hidden lg:block` desktop table while on a phone. Don't cap a
      // zero-rect element; leave it to size naturally.
      if (el.offsetParent === null) {
        setMaxHeight(undefined)
        return
      }
      const top = el.getBoundingClientRect().top
      const available = window.innerHeight - top - bottomGap
      const next = Math.max(MIN_HEIGHT, Math.round(available))
      // Ignore sub-pixel churn so the ResizeObserver settles instead of looping.
      setMaxHeight((cur) => (cur != null && Math.abs(cur - next) <= 1 ? cur : next))
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('resize', schedule)
    // Chrome above the table (a validation banner appearing, a filter row
    // wrapping) shifts our top offset without firing a window resize, so watch
    // the document for layout changes too.
    const ro = new ResizeObserver(schedule)
    ro.observe(document.body)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [bottomGap])

  return (
    <div
      ref={ref}
      className={`overflow-auto ${className}`.trim()}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  )
}
