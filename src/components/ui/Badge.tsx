import { BADGE_BASE, getStatusMeta, type StatusDomain, type StatusOf } from '@/lib/status-meta'

export type BadgeSize = 'sm' | 'md'

// sm matches the pill every legacy badge component rendered before this file
// existed (px-2.5 py-0.5 text-xs) — kept byte-identical so converting a
// legacy wrapper to Badge is a color/label change only, never a size change.
const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2.5 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
}

export interface BadgeProps<D extends StatusDomain> {
  domain: D
  status: StatusOf<D>
  /** Override the canonical label from status-meta.ts (rare — most callers want the canonical word). */
  label?: string
  size?: BadgeSize
  className?: string
}

/**
 * The one status pill in the app. `<Badge domain="service" status="estimated" />`
 * renders the canonical label + color for that (domain, status) pair from
 * `src/lib/status-meta.ts` — the single source of truth so a status word can't
 * drift in spelling or color across pages. Use this directly for any NEW status
 * display; the 6 legacy badge components (StatusBadge, ServiceStatusBadge,
 * PartsStatusBadge, CreditHoldBadge, CreditReviewBadge, TicketTypeBadge) are thin
 * wrappers around this for their existing call sites — don't add a 7th bespoke
 * badge, add a domain to status-meta instead.
 */
export default function Badge<D extends StatusDomain>({
  domain,
  status,
  label,
  size = 'sm',
  className = '',
}: BadgeProps<D>) {
  const meta = getStatusMeta(domain, status)
  return (
    <span className={`${BADGE_BASE} ${SIZE_CLASSES[size]} ${meta.classes} ${className}`.trim()}>
      {label ?? meta.label}
    </span>
  )
}
