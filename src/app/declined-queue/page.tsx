import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getDeclinedQueue } from '@/lib/db/declined-queue'
import DeclinedQueueClient from './DeclinedQueueClient'

export const dynamic = 'force-dynamic'

export default async function DeclinedQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getDeclinedQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Declined Estimates</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Estimates the customer declined. Follow up — re-quote and reopen, call the customer back, or
          mark it handled to clear it from the list.
        </p>
      </div>
      <DeclinedQueueClient rows={rows} />
    </div>
  )
}
