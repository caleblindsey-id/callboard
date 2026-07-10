import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'

export type StatusCountItem = {
  key: string
  label: string
  href: string
  icon: LucideIcon
  color: string
}

// Shared status-count grid card used by PmStatusSection and ServiceStatusSection
// (dashboard-5) — icon + label on top, count + chevron on the bottom row.
export default function StatusCountGrid({
  items,
  counts,
}: {
  items: StatusCountItem[]
  counts: Record<string, number>
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Link
            key={item.key}
            href={item.href}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {item.label}
              </span>
              <Icon className={`h-5 w-5 ${item.color}`} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
                {counts[item.key] ?? 0}
              </p>
              <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600" />
            </div>
          </Link>
        )
      })}
    </div>
  )
}
