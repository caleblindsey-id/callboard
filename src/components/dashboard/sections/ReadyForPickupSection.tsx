import { PackageCheck } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getReadyForPickupCounts } from '@/lib/db/dashboard-metrics'

export default async function ReadyForPickupSection() {
  const counts = await getReadyForPickupCounts()
  if (counts.total === 0) return null

  const parts: string[] = []
  if (counts.needsCall > 0) parts.push(`Needs call ${counts.needsCall}`)
  if (counts.aged30 > 0) parts.push(`30+ days ${counts.aged30}`)
  const subtitle = parts.length > 0 ? parts.join(' · ') : 'Awaiting customer pickup'

  return (
    <QueueStatCard
      href="/pickup-queue"
      icon={PackageCheck}
      title="Equipment awaiting customer pickup"
      subtitle={subtitle}
      count={counts.total}
    />
  )
}
