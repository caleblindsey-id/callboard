import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { SYNC_STALE_AFTER_HOURS, hoursSince, syncAgeLabel } from '@/lib/sync-staleness'

// Server component — reads sync_log directly. Replaces the prior client-side
// useEffect + /api/sync/status fetch, which forced a second round-trip after
// page paint. Manager+ gating is done by the caller (src/app/page.tsx).

interface SyncRow {
  sync_type: string
  started_at: string
  completed_at: string | null
  records_synced: number | null
  status: string | null
  error_message: string | null
}

export default async function SyncStatusBanner() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('sync_log')
    .select('sync_type, started_at, completed_at, records_synced, status, error_message')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sync = data as SyncRow | null

  if (!sync) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">No sync history available.</p>
      </div>
    )
  }

  const isSuccess = sync.status === 'success'
  const completedAt = sync.completed_at
    ? new Date(sync.completed_at).toLocaleString()
    : 'In progress'

  // A green "success" from days ago is not health — the sync is supposed to
  // run nightly, so age past the threshold means the cron is broken and stock
  // levels / customers / tax rates are silently drifting. Show that as its own
  // amber state instead of a reassuring green check next to an old timestamp.
  const age = hoursSince(sync.completed_at ?? sync.started_at)
  const isStale = isSuccess && age !== null && age > SYNC_STALE_AFTER_HOURS

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isSuccess ? (
            <XCircle className="h-5 w-5 text-red-500" />
          ) : isStale ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Last Sync: {sync.sync_type}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{completedAt}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {sync.records_synced !== null && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {sync.records_synced} records
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              !isSuccess
                ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                : isStale
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
            }`}
          >
            {isStale && age !== null ? `stale — ${syncAgeLabel(age)}` : sync.status}
          </span>
        </div>
      </div>
      {isStale && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          The nightly sync has not completed in over {SYNC_STALE_AFTER_HOURS} hours — stock levels,
          customers, ship-tos, and tax rates may be out of date. Check the sync scheduled task.
        </p>
      )}
      {sync.error_message && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{sync.error_message}</p>
      )}
    </div>
  )
}
