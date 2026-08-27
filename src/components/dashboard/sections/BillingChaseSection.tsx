import { ClipboardList } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getBillingChaseCounts } from '@/lib/db/billing-chase'

// Repurposed from PoNeededSection (migration 163): the card now covers all
// three Billing Chase reasons, not just a missing PO.
export default async function BillingChaseSection() {
  const counts = await getBillingChaseCounts()
  if (counts.total === 0) return null

  return (
    <QueueStatCard
      href="/billing/po-follow-up"
      icon={ClipboardList}
      title="Billing Chase"
      subtitle={`Not entered ${counts.notEntered} · PO needed ${counts.poMissing} · Not invoiced ${counts.notInvoiced}`}
      count={counts.total}
    />
  )
}
