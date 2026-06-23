'use client'

import type { ServiceTicketType } from '@/types/service-tickets'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

// Inside/outside toggle for the Service Tickets billing tab. Writes ?serviceType
// to the URL (same hook the tab toggle uses); the server page re-queries and
// filters BOTH service lists — Ready to Export and Awaiting Invoice # — so the
// manager works one group at a time (feedback #51). '' = show all.
const TYPE_OPTIONS: { value: '' | ServiceTicketType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
]

interface ServiceTypeFilterProps {
  // Active value, seeded from the server page's searchParams.
  initial: string
}

export default function ServiceTypeFilter({ initial }: ServiceTypeFilterProps) {
  const { filters, set } = useUrlFilters({ serviceType: initial })
  const selected = filters.serviceType

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Service Type</label>
      <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
        {TYPE_OPTIONS.map((opt) => {
          const active = selected === opt.value
          return (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => set('serviceType', opt.value)}
              aria-pressed={active}
              className={`px-3 py-1.5 text-sm font-medium transition-colors min-h-[36px] ${
                active
                  ? 'bg-slate-800 text-white dark:bg-slate-600'
                  : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
