'use client'

import { ReactNode } from 'react'
import { useUrlFilters } from '@/lib/hooks/useUrlFilters'
import Tabs, { type TabItem } from '@/components/ui/Tabs'

interface BillingTabsProps {
  pmCount: number
  serviceCount: number
  invoicedCount: number
  pmContent: ReactNode
  serviceContent: ReactNode
  invoicedContent: ReactNode
  initialTab: string
}

export default function BillingTabs({
  pmCount,
  serviceCount,
  invoicedCount,
  pmContent,
  serviceContent,
  invoicedContent,
  initialTab,
}: BillingTabsProps) {
  // Tab lives in the URL (preserving the month/year params BillingExport owns)
  // so it survives Back and dashboard deep links.
  const { filters, set } = useUrlFilters({ tab: initialTab })
  const active: 'pm' | 'service' | 'invoiced' =
    filters.tab === 'service' ? 'service' : filters.tab === 'invoiced' ? 'invoiced' : 'pm'

  const tabs: TabItem[] = [
    { key: 'pm', label: 'PM Tickets', count: pmCount },
    { key: 'service', label: 'Service Tickets', count: serviceCount },
    { key: 'invoiced', label: 'Invoiced', count: invoicedCount },
  ]

  return (
    <div className="space-y-4">
      <Tabs
        ariaLabel="Billing tabs"
        tabs={tabs}
        active={active}
        onChange={(key) => set('tab', key === 'pm' ? '' : key)}
      />
      <div>{active === 'pm' ? pmContent : active === 'service' ? serviceContent : invoicedContent}</div>
    </div>
  )
}
