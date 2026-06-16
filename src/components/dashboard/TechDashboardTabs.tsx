'use client'

import { ReactNode } from 'react'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'

interface TechDashboardTabsProps {
  pmCount: number
  serviceCount: number
  attentionCount: number
  overviewContent: ReactNode
  pmContent: ReactNode
  serviceContent: ReactNode
  initialTab: string
}

type Tab = 'overview' | 'pm' | 'service'

export default function TechDashboardTabs({
  pmCount,
  serviceCount,
  attentionCount,
  overviewContent,
  pmContent,
  serviceContent,
  initialTab,
}: TechDashboardTabsProps) {
  // Tab lives in the URL so Back restores it and `/?tab=service` deep-links.
  // Seeded from the server `searchParams` (never useSearchParams) per useUrlFilters.
  const { filters, set } = useUrlFilters({ tab: initialTab })
  const active: Tab =
    filters.tab === 'pm' ? 'pm' : filters.tab === 'service' ? 'service' : 'overview'

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4" aria-label="Dashboard tabs">
          <TabButton
            label="Overview"
            count={attentionCount}
            tone={attentionCount > 0 ? 'alert' : 'hidden'}
            active={active === 'overview'}
            onClick={() => set('tab', '')}
          />
          <TabButton
            label="PM"
            count={pmCount}
            tone="neutral"
            active={active === 'pm'}
            onClick={() => set('tab', 'pm')}
          />
          <TabButton
            label="Service"
            count={serviceCount}
            tone="neutral"
            active={active === 'service'}
            onClick={() => set('tab', 'service')}
          />
        </nav>
      </div>
      <div>
        {active === 'overview'
          ? overviewContent
          : active === 'pm'
            ? pmContent
            : serviceContent}
      </div>
    </div>
  )
}

function TabButton({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  tone: 'neutral' | 'alert' | 'hidden'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors min-h-[44px] flex items-center gap-2 ${
        active
          ? 'border-slate-700 text-slate-900 dark:border-slate-300 dark:text-white'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      <span>{label}</span>
      {tone !== 'hidden' && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
            tone === 'alert'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              : active
                ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  )
}
