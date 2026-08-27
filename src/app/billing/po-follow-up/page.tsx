import { getBillingChaseQueue } from '@/lib/db/billing-chase'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import PoFollowUpWorklist from './PoFollowUpWorklist'
import PageHeader from '@/components/ui/PageHeader'

// Billing Chase worklist: completed PM and service jobs missing any of the
// three things billing needs — a Synergy order #, a required customer PO, or
// (once exported) a Synergy invoice #. Manager-gated (mirrors /billing).
// Replaces the office's handwritten PO-chasing notes — log each contact
// attempt and enter the missing field here to clear the job for billing.
export default async function PoFollowUpPage() {
  await requireRole(...MANAGER_ROLES)

  const tickets = await getBillingChaseQueue()

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Billing Chase"
        subtitle="Enter the Synergy order, collect the PO, and confirm invoicing — everything holding up billing"
        backHref="/billing"
      />
      <PoFollowUpWorklist tickets={tickets} />
    </div>
  )
}
