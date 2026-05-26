'use client'

import { useState, ReactNode } from 'react'

interface BillingTabsProps {
  pmCount: number
  serviceCount: number
  pmContent: ReactNode
  serviceContent: ReactNode
}

export default function BillingTabs({
  pmCount,
  serviceCount,
  pmContent,
  serviceContent,
}: BillingTabsProps) {
  const [active, setActive] = useState<'pm' | 'service'>('pm')

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4" aria-label="Billing tabs">
          <TabButton
            label="PM Tickets"
            count={pmCount}
            active={active === 'pm'}
            onClick={() => setActive('pm')}
          />
          <TabButton
            label="Service Tickets"
            count={serviceCount}
            active={active === 'service'}
            onClick={() => setActive('service')}
          />
        </nav>
      </div>
      <div>{active === 'pm' ? pmContent : serviceContent}</div>
    </div>
  )
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
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
      <span
        className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
          active
            ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
