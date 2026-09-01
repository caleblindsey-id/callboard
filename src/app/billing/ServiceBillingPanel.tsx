'use client'

import { useState } from 'react'
import type { ServiceBillingTicket } from '@/lib/db/service-tickets'
import FilterBar from '@/components/ui/FilterBar'
import ServiceTypeFilter from './ServiceTypeFilter'
import ServiceBillingExport from './ServiceBillingExport'
import ServiceAwaitingInvoice from './ServiceAwaitingInvoice'

interface ServiceBillingPanelProps {
  tickets: ServiceBillingTicket[]
  awaitingInvoice: ServiceBillingTicket[]
  selectedMonth?: number
  selectedYear?: number
  // Active inside/outside narrowing from the URL ('' = All). The filtering
  // itself happens server-side in page.tsx; this panel only renders the toggle
  // and reports it to FilterBar's mobile "Filters" badge.
  serviceType: string
}

/**
 * The service billing tab: one search box over BOTH pipeline stages, in the
 * same filter row as the inside/outside toggle.
 *
 * The query lives here rather than in each list because a coordinator looking
 * for a customer doesn't know, and shouldn't have to guess, whether that
 * ticket is still Ready to Export or already Awaiting an Invoice # — typing
 * once narrows both (feedback #92). Local state, not URL-synced, matching the
 * PM/service boards; switching tabs unmounts this panel and clears the query.
 */
export default function ServiceBillingPanel({
  tickets,
  awaitingInvoice,
  selectedMonth,
  selectedYear,
  serviceType,
}: ServiceBillingPanelProps) {
  const [search, setSearch] = useState('')

  return (
    <div className="space-y-6">
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Customer, WO#, equipment, tech, PO#',
        }}
        activeCount={serviceType ? 1 : 0}
      >
        <ServiceTypeFilter initial={serviceType} />
      </FilterBar>
      <ServiceBillingExport
        tickets={tickets}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        search={search}
      />
      <ServiceAwaitingInvoice tickets={awaitingInvoice} search={search} />
    </div>
  )
}
