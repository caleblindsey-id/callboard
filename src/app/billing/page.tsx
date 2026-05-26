import { getBillingTickets } from '@/lib/db/tickets'
import { getServiceBillingTickets } from '@/lib/db/service-tickets'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import BillingExport from './BillingExport'
import ServiceBillingExport from './ServiceBillingExport'
import BillingTabs from './BillingTabs'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const params = await searchParams
  const now = new Date()
  const month = params.month ? parseInt(params.month) : now.getMonth() + 1
  const year = params.year ? parseInt(params.year) : now.getFullYear()

  const [pmTickets, serviceTickets] = await Promise.all([
    getBillingTickets(month, year),
    getServiceBillingTickets(month, year),
  ])
  const pmUnexported = pmTickets.filter((t) => !t.billing_exported)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Billing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Completed tickets ready to bill into Synergy
        </p>
      </div>
      <BillingTabs
        pmCount={pmUnexported.length}
        serviceCount={serviceTickets.length}
        pmContent={
          <div className="space-y-4">
            <BillingExport tickets={pmUnexported} defaultMonth={month} defaultYear={year} />
          </div>
        }
        serviceContent={
          <div className="space-y-4">
            <ServiceBillingExport tickets={serviceTickets} defaultMonth={month} defaultYear={year} />
          </div>
        }
      />
    </div>
  )
}
