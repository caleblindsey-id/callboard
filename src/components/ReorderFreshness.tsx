import { AlertTriangle } from 'lucide-react'
import { SYNC_STALE_AFTER_HOURS, hoursSince, syncAgeLabel } from '@/lib/sync-staleness'

// Tiny inline "as of" stamp for the reorder walk/review headers, driven by
// session.inventory_as_of (stamped at session creation from MAX(synced_at)
// across the in-scope inv_reorder rows — see sessions/route.ts POST). Not a
// full SyncStatusBanner: this is a one-line note on a workflow page, not a
// dashboard zone.
export default function ReorderFreshness({ inventoryAsOf }: { inventoryAsOf: string | null }) {
  if (!inventoryAsOf) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500">Inventory freshness unavailable</p>
    )
  }

  const age = hoursSince(inventoryAsOf)
  const isStale = age !== null && age > SYNC_STALE_AFTER_HOURS
  const asOf = new Date(inventoryAsOf).toLocaleString()

  if (isStale && age !== null) {
    return (
      <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Inventory as of {asOf} ({syncAgeLabel(age)}, may be stale)
      </p>
    )
  }

  return <p className="text-xs text-gray-500 dark:text-gray-400">Inventory as of {asOf}</p>
}
