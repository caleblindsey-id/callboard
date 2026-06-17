import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import { getSupplyRequestQueue } from '@/lib/db/supply-requests'
import SupplyRequestsClient from './SupplyRequestsClient'

export const dynamic = 'force-dynamic'

export default async function SupplyRequestsPage() {
  await requireRole(...MANAGER_ROLES)
  const rows = await getSupplyRequestQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Supply Requests</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Shop supplies technicians have asked the warehouse to pull and stage for pickup.
        </p>
      </div>
      <SupplyRequestsClient rows={rows} />
    </div>
  )
}
