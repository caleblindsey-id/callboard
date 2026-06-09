import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPickupQueue } from '@/lib/db/pickup-queue'
import PickupQueueClient from './PickupQueueClient'

export const dynamic = 'force-dynamic'

export default async function PickupQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPickupQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Ready for Pickup</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Repaired and invoiced equipment waiting in the shop for the customer to collect. Confirm a
          pickup to release custody; units with no email on file need a phone call.
        </p>
      </div>
      <PickupQueueClient rows={rows} />
    </div>
  )
}
