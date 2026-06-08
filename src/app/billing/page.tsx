import { getBillingTickets, getPmAwaitingInvoiceTickets } from '@/lib/db/tickets'
import { getServiceBillingTickets } from '@/lib/db/service-tickets'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import BillingExport from './BillingExport'
import PmAwaitingInvoice from './PmAwaitingInvoice'
import ServiceBillingExport from './ServiceBillingExport'
import BillingTabs from './BillingTabs'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  await requireRole(...MANAGER_ROLES)
  const params = await searchParams

  // Default scope is ALL unbilled tickets regardless of month. month/year are
  // an optional narrowing filter, applied only when both are valid in the URL —
  // otherwise prior-month completions silently fall off the billing queue.
  const parsedMonth = params.month ? parseInt(params.month) : NaN
  const parsedYear = params.year ? parseInt(params.year) : NaN
  const hasFilter =
    Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12 &&
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
  const month = hasFilter ? parsedMonth : undefined
  const year = hasFilter ? parsedYear : undefined

  const [pmTickets, pmAwaitingInvoice, serviceTickets] = await Promise.all([
    getBillingTickets(month, year),
    getPmAwaitingInvoiceTickets(month, year),
    getServiceBillingTickets(month, year),
  ])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Billing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Completed tickets ready to bill into Synergy
        </p>
      </div>
      <BillingTabs
        pmCount={pmTickets.length}
        serviceCount={serviceTickets.length}
        pmContent={
          <div className="space-y-6">
            <BillingExport tickets={pmTickets} selectedMonth={month} selectedYear={year} />
            <PmAwaitingInvoice tickets={pmAwaitingInvoice} />
          </div>
        }
        serviceContent={
          <div className="space-y-4">
            <ServiceBillingExport tickets={serviceTickets} selectedMonth={month} selectedYear={year} />
          </div>
        }
      />
    </div>
  )
}
