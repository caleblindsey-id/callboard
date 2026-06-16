import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getWarrantyQueue } from '@/lib/db/warranty-queue'
import WarrantyQueueClient from './WarrantyQueueClient'

export const dynamic = 'force-dynamic'

export default async function WarrantyQueuePage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getWarrantyQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Warranty Claims</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Completed warranty repairs move through the vendor-credit lifecycle here: file the claim,
          wait for the credit that offsets covered parts, then log it. A warranty ticket can&apos;t be
          billed until the credit is recorded.
        </p>
      </div>
      <WarrantyQueueClient rows={rows} />
    </div>
  )
}
