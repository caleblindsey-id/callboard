import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getPickupQueue } from '@/lib/db/pickup-queue'
import PickupQueueClient from './PickupQueueClient'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

export default async function PickupQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getPickupQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Ready for Pickup"
        subtitle="Repaired and invoiced equipment waiting in the shop for the customer to collect. Confirm a pickup to release custody; units with no email on file need a phone call."
      />
      <PickupQueueClient rows={rows} />
    </div>
  )
}
