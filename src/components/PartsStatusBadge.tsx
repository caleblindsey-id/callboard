import type { MyPartStatus } from '@/lib/db/parts-queue'

const statusConfig: Record<MyPartStatus, { label: string; classes: string }> = {
  received: {
    label: 'Ready for Pickup',
    classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  ordered: {
    label: 'On Order',
    classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  requested: {
    label: 'Awaiting Order',
    classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
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
