import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SYNC_STALE_AFTER_HOURS, hoursSince, syncAgeLabel } from '@/lib/sync-staleness'

// Compact ERP-staleness strip for coordinator worklists (parts queue, estimate
// follow-up). Renders nothing while the nightly sync is on schedule; appears
// only once the last SUCCESSFUL sync is older than the threshold. The parts
// order-vs-pull triage snapshots qty-on-hand from synced data, and customers /
// ship-tos / tax rates all ride the same nightly sync — without this strip
// those decisions degrade with zero indication anywhere off the manager
// dashboard.
export default async function SyncStaleNotice() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sync_log')
    .select('completed_at, started_at')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as { completed_at: string | null; started_at: string | null } | null
  const hours = hoursSince(row?.completed_at ?? row?.started_at)
  if (hours !== null && hours <= SYNC_STALE_AFTER_HOURS) return null

  const detail =
    hours === null ? 'no successful sync on record' : `last successful sync ${syncAgeLabel(hours)}`
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        ERP data may be out of date ({detail}). Stock levels, customers, and tax rates ride the
        nightly sync.
      </span>
    </div>
  )
}
