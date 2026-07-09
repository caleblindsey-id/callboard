import { FileX } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getDeclinedCounts } from '@/lib/db/declined-queue'

export default async function DeclinedEstimatesSection() {
  const counts = await getDeclinedCounts()
  if (counts.total === 0) return null

  return (
    <QueueStatCard
      href="/declined-queue"
      icon={FileX}
      title="Declined estimates to follow up"
      subtitle="Re-quote, call back, or mark handled"
      count={counts.total}
    />
  )
}
