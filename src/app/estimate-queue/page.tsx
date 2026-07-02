import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getEstimateQueue } from '@/lib/db/estimate-queue'
import EstimateQueueClient from './EstimateQueueClient'
import SyncStaleNotice from '@/components/SyncStaleNotice'

export const dynamic = 'force-dynamic'

export default async function EstimateQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getEstimateQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Estimate Follow-Up</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Estimates waiting on a customer decision. Make first contact — email the approval link or
          log a call — then follow up until the estimate is approved or declined.
        </p>
      </div>
      {/* Estimate tax lines ride the synced customer tax rates — warn when stale. */}
      <SyncStaleNotice />
      <EstimateQueueClient rows={rows} />
    </div>
  )
}
