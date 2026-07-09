import { getPoFollowUpQueue } from '@/lib/db/service-tickets'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PoFollowUpWorklist from './PoFollowUpWorklist'
import PageHeader from '@/components/ui/PageHeader'

// PO-collection worklist: completed jobs for PO-required customers still missing
// a customer PO. Manager-gated (mirrors /billing). Replaces the office's
// handwritten PO-chasing notes — log each contact attempt and enter the PO here
// to clear the job for billing.
export default async function PoFollowUpPage() {
  await requireRole(...MANAGER_ROLES)

  const tickets = await getPoFollowUpQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="PO Follow-Up"
        subtitle="Chase the customer POs that are holding up billing"
        backHref="/billing"
      />
      <PoFollowUpWorklist tickets={tickets} />
    </div>
  )
}
