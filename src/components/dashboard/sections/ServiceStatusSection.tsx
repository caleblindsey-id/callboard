import { Headset } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
import StatusCountGrid, { type StatusCountItem } from '@/components/dashboard/StatusCountGrid'
import { getServiceTicketCounts } from '@/lib/db/service-tickets'
import { getStatusMeta } from '@/lib/status-meta'

const serviceStatusCards: { key: string; label: string; color: string }[] = [
  { key: 'open', label: 'Open', color: 'text-green-500' },
  { key: 'estimated', label: getStatusMeta('service', 'estimated').label, color: 'text-yellow-500' },
  { key: 'approved', label: 'Approved', color: 'text-purple-500' },
  { key: 'in_progress', label: 'In Progress', color: 'text-blue-500' },
  { key: 'completed', label: 'Completed', color: 'text-emerald-500' },
]

export default async function ServiceStatusSection() {
  const serviceCounts = await getServiceTicketCounts()

  const items: StatusCountItem[] = serviceStatusCards.map((card) => ({
    key: card.key,
    label: card.label,
    icon: Headset,
    color: card.color,
    href: `/service?status=${card.key}`,
  }))

  return (
    <section>
      <ZoneHeader label="Service Tickets" />
      <StatusCountGrid items={items} counts={serviceCounts} />
    </section>
  )
}
