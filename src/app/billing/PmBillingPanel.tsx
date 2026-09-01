'use client'

import { useState } from 'react'
import type { TicketWithJoins } from '@/lib/db/tickets'
import FilterBar from '@/components/ui/FilterBar'
import BillingExport from './BillingExport'
import PmAwaitingInvoice from './PmAwaitingInvoice'

interface PmBillingPanelProps {
  tickets: TicketWithJoins[]
  awaitingInvoice: TicketWithJoins[]
  selectedMonth?: number
  selectedYear?: number
}

/**
 * The PM billing tab: one search box over BOTH pipeline stages.
 *
 * The query lives here rather than in each list because a coordinator looking
 * for a customer doesn't know, and shouldn't have to guess, whether that
 * ticket is still Ready to Export or already Awaiting an Invoice # — typing
 * once narrows both (feedback #92). Local state, not URL-synced, matching the
 * PM/service boards; switching tabs unmounts this panel and clears the query.
 */
export default function PmBillingPanel({
  tickets,
  awaitingInvoice,
  selectedMonth,
  selectedYear,
}: PmBillingPanelProps) {
  const [search, setSearch] = useState('')

  return (
    <div className="space-y-6">
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Customer, WO#, equipment, tech, PO#',
        }}
      />
      <BillingExport
        tickets={tickets}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        search={search}
      />
      <PmAwaitingInvoice tickets={awaitingInvoice} search={search} />
    </div>
  )
}
