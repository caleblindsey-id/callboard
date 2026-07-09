import Link from 'next/link'
import { Headset } from 'lucide-react'
import ZoneHeader from '@/components/dashboard/ZoneHeader'
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

  return (
    <section>
      <ZoneHeader label="Service Tickets" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4">
        {serviceStatusCards.map((card) => (
          <Link
            key={card.key}
            href={`/service?status=${card.key}`}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{card.label}</span>
              <Headset className={`h-5 w-5 ${card.color}`} />
            </div>
            <p className="mt-2 text-xl sm:text-2xl font-semibold text-gray-900 dark:text-white tabular-nums">
              {serviceCounts[card.key] ?? 0}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
