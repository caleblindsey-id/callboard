import { getPoFollowUpQueue } from '@/lib/db/service-tickets'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PoFollowUpWorklist from './PoFollowUpWorklist'

// PO-collection worklist: completed jobs for PO-required customers still missing
// a customer PO. Manager-gated (mirrors /billing). Replaces the office's
// handwritten PO-chasing notes — log each contact attempt and enter the PO here
// to clear the job for billing.
export default async function PoFollowUpPage() {
  await requireRole(...MANAGER_ROLES)

  const tickets = await getPoFollowUpQueue()

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">PO Follow-Up</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Chase the customer POs that are holding up billing
        </p>
      </div>
      <PoFollowUpWorklist tickets={tickets} />
    </div>
  )
}
