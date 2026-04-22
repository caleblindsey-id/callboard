import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPartsQueue } from '@/lib/db/parts-queue'
import PartsQueueClient from './PartsQueueClient'

export const dynamic = 'force-dynamic'

export default async function PartsQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPartsQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Parts Queue</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Parts requested by techs across PM and service tickets — enter Synergy item #, PO #, and vendor here.
        </p>
      </div>
      <PartsQueueClient rows={rows} />
    </div>
  )
}
