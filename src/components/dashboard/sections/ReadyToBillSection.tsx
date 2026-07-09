import { Receipt } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getReadyToBillCounts } from '@/lib/db/dashboard-metrics'

export default async function ReadyToBillSection() {
  const counts = await getReadyToBillCounts()
  const total = counts.pmCount + counts.serviceCount
  if (total === 0) return null

  const totalAmount = counts.pmAmount + counts.serviceAmount

  return (
    <QueueStatCard
      href="/billing"
      icon={Receipt}
      title="Ready to Bill into Synergy"
      subtitle={`PM ${counts.pmCount} · Service ${counts.serviceCount} · $${totalAmount.toFixed(2)} total`}
      count={total}
    />
  )
}
