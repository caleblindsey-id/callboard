'use client'

import { useEffect, useId, useRef } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { X } from 'lucide-react'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-4xl',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Header title. Omit entirely for dialogs that build their own header inline in `children`
   * (e.g. ConfirmDialog); in that case pass `ariaLabelledBy` pointing at the id you render yourself. */
  title?: ReactNode
  /** Rendered left of the title inside the header row, e.g. a `Back` button on a multi-step sheet. Ignored if `title` is omitted. */
  headerLeft?: ReactNode
  /** Footer row (border-t, right-aligned button group). Omit for dialogs that render their own
   * action row as part of `children` (matches most of the current fleet). */
  footer?: ReactNode
  size?: ModalSize
  /** Mobile bottom-sheet: full-width, `items-end`, rounded top corners under `sm:`; centered card at `sm:` and up. Default false (always centered). */
  sheet?: boolean
  /** Governs backdrop-click-to-close, Escape-to-close, and the header close button. Callers
   * pass `dismissible={!submitting}` while a commit is in flight: there is no separate `loading` prop. */
  dismissible?: boolean
  /** Body content. Always scrollable (`overflow-y-auto`), the panel caps at `max-h-[90vh]`. */
  children: ReactNode
  /** Extra classes on the panel itself (backdrop-adjacent box), use for padding on header/footer-less dialogs, e.g. `className="p-6"`. */
  className?: string
  /** Extra classes on the scrollable body wrapper. Rarely needed; most callers pad their own children. */
  contentClassName?: string
  /** Id of the element that labels the dialog for screen readers. Auto-generated from `title` when set; required if `title` is omitted and you want an accessible name. */
  ariaLabelledBy?: string
}

/**
 * The one modal shell in the app. Generalizes ConfirmDialog's proven focus /
 * Escape / loading-guard behavior (role="dialog", aria-modal, focus-on-open,
 * Tab-cycling focus trap, Escape via stopImmediatePropagation, scroll lock)
 * so every dialog inherits it instead of re-implementing it per shell. Not a
 * portal: nothing else in this app renders through a portal (see Toast),
 * this stays consistent with that convention.
 *
 * When to use what:
 * - `Modal` (this file): any create/edit/preview dialog, or a bottom-sheet on
 *   mobile via `sheet`. Compose it directly; pass your existing header/body/
 *   footer JSX as `children` if you don't need the `title`/`footer` slots.
 * - `ConfirmDialog`: a yes/no decision or destructive/financial confirm. It
 *   is a thin preset built on this component, use it instead of hand-rolling
 *   a confirm inside a bare `Modal`.
 * - Inline expand panel (no Modal at all): a quick one-to-two-field edit taken
 *   in the flow of scanning a queue (PickQ, WarrQ, SupReq, PartsQ, Prosp), or
 *   tech in-flow data entry (skip-request form, parts/supply entry). These
 *   stay inline per the UX standard's dimension 8 exceptions, don't wrap them
 *   in a modal just for consistency's sake.
 */
export default function Modal({
  open,
  onClose,
  title,
  headerLeft,
  footer,
  size = 'md',
  sheet = false,
  dismissible = true,
  children,
  className = '',
  contentClassName = '',
  ariaLabelledBy,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const autoId = useId()
  const titleId = ariaLabelledBy ?? (title ? `modal-title-${autoId}` : undefined)

  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    lockScroll()
    return unlockScroll
  }, [open])

  if (!open) return null

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      // Swallow the Escape so an ancestor dialog's own document-level keydown
      // listener (several bespoke shells still register one directly, see
      // BillingNotesDrawer/LeadReviewModal/etc.) doesn't also fire and close
      // both at once. Next mounts React's synthetic event root on `document`,
      // so a plain stopPropagation can't block a sibling native listener on
      // that same node: stopImmediatePropagation is required.
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      if (dismissible) onClose()
      return
    }
    if (e.key === 'Tab') {
      trapFocus(e, dialogRef.current)
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={`fixed inset-0 z-50 flex justify-center outline-none ${sheet ? 'items-end sm:items-center' : 'items-center'}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="fixed inset-0 bg-black/50"
        aria-hidden="true"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        className={`relative w-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col max-h-[90vh] ${sheet ? 'rounded-t-2xl sm:rounded-lg mx-0 sm:mx-4' : 'rounded-lg mx-4'} ${SIZE_CLASSES[size]} ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {headerLeft}
              <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white truncate">
                {title}
              </h3>
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 -m-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className={`overflow-y-auto flex-1 ${contentClassName}`}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

function trapFocus(e: KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (!container) return
  const focusable = getFocusable(container)
  if (focusable.length === 0) {
    e.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (e.shiftKey) {
    if (active === first || active === container) {
      e.preventDefault()
      last.focus()
    }
  } else if (active === last) {
    e.preventDefault()
    first.focus()
  }
}

// Ref-counted so a Modal nested inside another open Modal (e.g. a ConfirmDialog
// opened from within a bigger Modal) doesn't restore `overflow` early when the
// inner one closes while the outer one is still open.
let lockCount = 0
let previousOverflow = ''

function lockScroll() {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount++
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow
  }
}
