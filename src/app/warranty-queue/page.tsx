import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getWarrantyQueue } from '@/lib/db/warranty-queue'
import WarrantyQueueClient from './WarrantyQueueClient'
import PageHeader from '@/components/ui/PageHeader'

export const dynamic = 'force-dynamic'

export default async function WarrantyQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getWarrantyQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Warranty Claims"
        subtitle="Completed warranty repairs move through the vendor-credit lifecycle here: file the claim, wait for the credit that offsets covered parts, then log it. A warranty ticket can't be billed until the credit is recorded."
      />
      <WarrantyQueueClient rows={rows} />
    </div>
  )
}
