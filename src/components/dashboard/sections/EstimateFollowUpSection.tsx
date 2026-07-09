import { FileText } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getPendingEstimateCounts } from '@/lib/db/estimate-queue'

export default async function EstimateFollowUpSection() {
  const counts = await getPendingEstimateCounts()
  if (counts.total === 0) return null

  const subtitle =
    counts.needsFirstContact > 0
      ? `${counts.needsFirstContact} need first contact`
      : 'All contacted — following up for a decision'

  return (
    <QueueStatCard
      href="/estimate-queue"
      icon={FileText}
      title="Estimates awaiting a customer decision"
      subtitle={subtitle}
      alertSubtitle={counts.needsFirstContact > 0}
      count={counts.total}
    />
  )
}
