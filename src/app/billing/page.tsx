import { getTickets } from '@/lib/db/tickets'
import { requireRole } from '@/lib/auth'
import BillingExport from './BillingExport'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  await requireRole('manager', 'coordinator')
  const params = await searchParams
  const now = new Date()
  const month = params.month ? parseInt(params.month) : now.getMonth() + 1
  const year = params.year ? parseInt(params.year) : now.getFullYear()

  const tickets = await getTickets({ month, year, status: 'completed' })
  const unexported = tickets.filter((t) => !t.billing_exported)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Billing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Export completed tickets for billing
        </p>
      </div>
      <BillingExport tickets={unexported} defaultMonth={month} defaultYear={year} />
    </div>
  )
}
