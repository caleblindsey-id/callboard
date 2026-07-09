import { ShieldCheck } from 'lucide-react'
import QueueStatCard from '@/components/dashboard/QueueStatCard'
import { getWarrantyClaimCounts } from '@/lib/db/warranty-queue'

export default async function WarrantyClaimsSection() {
  const counts = await getWarrantyClaimCounts()
  if (counts.actionable === 0) return null

  const parts: string[] = []
  if (counts.toFile > 0) parts.push(`${counts.toFile} to file`)
  if (counts.awaitingCredit > 0) parts.push(`${counts.awaitingCredit} awaiting credit`)

  return (
    <QueueStatCard
      href="/warranty-queue"
      icon={ShieldCheck}
      title="Warranty claims to work"
      subtitle={parts.join(' · ') || 'File claims and log vendor credits'}
      count={counts.actionable}
    />
  )
}
