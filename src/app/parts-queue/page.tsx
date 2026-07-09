import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPartsQueue } from '@/lib/db/parts-queue'
import type { PartsQueueSource } from '@/types/database'
import PartsQueueClient from './PartsQueueClient'
import SyncStaleNotice from '@/components/SyncStaleNotice'
import PageHeader from '@/components/ui/PageHeader'

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
  // Next 15+ delivers searchParams as a Promise — reading properties without
  // awaiting silently yields undefined, which broke the ?ticket deep-link and
  // the Back-button filter restore on this page after the Next 16 upgrade.
  searchParams?: Promise<{
    source?: string | string[]
    ticket?: string | string[]
    tab?: string | string[]
    sort?: string | string[]
    dir?: string | string[]
    q?: string | string[]
    vendor?: string | string[]
  }>
}) {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPartsQueue()

  const params = (await searchParams) ?? {}
  const ticketFilter = firstString(params.ticket)
  const sourceFilter = normalizeSource(params.source)
  // Seed the board's controls from the URL so the Back button restores them.
  const initialFilters = {
    tab: firstString(params.tab) ?? '',
    sort: firstString(params.sort) ?? '',
    dir: firstString(params.dir) ?? '',
    q: firstString(params.q) ?? '',
    source: sourceFilter ?? '',
    vendor: firstString(params.vendor) ?? '',
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Parts Queue"
        subtitle="Parts requested by techs across PM and service tickets — enter Synergy item #, PO #, and vendor here."
      />
      {/* Stock-vs-order triage runs on synced qty-on-hand — warn when it's stale. */}
      <SyncStaleNotice />
      <PartsQueueClient
        rows={rows}
        initialTicketFilter={ticketFilter}
        initialFilters={initialFilters}
      />
    </div>
  )
}
