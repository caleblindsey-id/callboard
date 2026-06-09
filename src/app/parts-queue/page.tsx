import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPartsQueue } from '@/lib/db/parts-queue'
import type { PartsQueueSource } from '@/types/database'
import PartsQueueClient from './PartsQueueClient'

export const dynamic = 'force-dynamic'

// Round B (service-ticket deep-link) will navigate here with
//   /parts-queue?source=service&ticket=<uuid>
// to surface only the parts attached to that ticket. The query-param contract
// is intentionally simple: ?ticket=<id> alone also works; ?source narrows the
// match to one of 'pm' | 'service' when present. Anything else is ignored.
function normalizeSource(raw: string | string[] | undefined): PartsQueueSource | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return v === 'pm' || v === 'service' ? v : null
}

function firstString(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

export default async function PartsQueuePage({
  searchParams,
}: {
  searchParams?: {
    source?: string | string[]
    ticket?: string | string[]
    tab?: string | string[]
    sort?: string | string[]
    dir?: string | string[]
    q?: string | string[]
    vendor?: string | string[]
  }
}) {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPartsQueue()

  const ticketFilter = firstString(searchParams?.ticket)
  const sourceFilter = normalizeSource(searchParams?.source)
  // Seed the board's controls from the URL so the Back button restores them.
  const initialFilters = {
    tab: firstString(searchParams?.tab) ?? '',
    sort: firstString(searchParams?.sort) ?? '',
    dir: firstString(searchParams?.dir) ?? '',
    q: firstString(searchParams?.q) ?? '',
    source: sourceFilter ?? '',
    vendor: firstString(searchParams?.vendor) ?? '',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Parts Queue</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Parts requested by techs across PM and service tickets — enter Synergy item #, PO #, and vendor here.
        </p>
      </div>
      <PartsQueueClient
        rows={rows}
        initialTicketFilter={ticketFilter}
        initialFilters={initialFilters}
      />
    </div>
  )
}
