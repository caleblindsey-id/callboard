import type { MyPartStatus } from '@/lib/db/parts-queue'

const statusConfig: Record<MyPartStatus, { label: string; classes: string }> = {
  received: {
    label: 'Ready for Pickup',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  from_stock: {
    label: 'From Stock',
    classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  },
  ordered: {
    label: 'On Order',
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  requested: {
    label: 'Awaiting Order',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  pending_review: {
    label: 'Pending Review',
    classes: 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  },
}

export default function PartsStatusBadge({ status }: { status: MyPartStatus }) {
  const config = statusConfig[status]
  if (!config) return null
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  )
}
