import type { CreditReviewStatus } from '@/types/database'

// Per-ORDER credit review state. Distinct from CreditHoldBadge, which reflects
// the customer-level (sync-owned) credit_hold flag.
const CONFIG: Record<CreditReviewStatus, { label: string; cls: string }> = {
  pending: {
    label: 'Pending Credit Review',
    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  blocked: {
    label: 'Blocked (Credit)',
    cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  released: {
    label: 'Credit Released',
    cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
}

export default function CreditReviewBadge({ status }: { status: CreditReviewStatus }) {
  const cfg = CONFIG[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
