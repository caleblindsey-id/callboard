import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getDeclinedQueue } from '@/lib/db/declined-queue'
import DeclinedQueueClient from './DeclinedQueueClient'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

export default async function DeclinedQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getDeclinedQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Declined Estimates"
        subtitle={`${rows.length} declined estimate${rows.length === 1 ? '' : 's'} awaiting follow-up. Follow up — re-quote and reopen, call the customer back, or mark it handled to clear it from the list.`}
      />
      <DeclinedQueueClient rows={rows} />
    </div>
  )
}
