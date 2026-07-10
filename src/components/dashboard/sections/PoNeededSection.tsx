import { ClipboardList } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getPoNeededCount } from '@/lib/db/service-tickets'

export default async function PoNeededSection() {
  const count = await getPoNeededCount()
  if (count === 0) return null

  return (
    <QueueStatCard
      href="/billing/po-follow-up"
      icon={ClipboardList}
      title="Completed jobs waiting on a customer PO"
      subtitle="Enter the customer PO so these can be billed"
      count={count}
    />
  )
}
