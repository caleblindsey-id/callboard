import { getBillingTickets, getPmAwaitingInvoiceTickets } from '@/lib/db/tickets'
import { getServiceBillingTickets, getServiceAwaitingInvoiceTickets } from '@/lib/db/service-tickets'
import { getInvoicedRows } from '@/lib/db/invoiced'
import { requireRole, MANAGER_ROLES } from '@/lib/auth'
import BillingExport from './BillingExport'
import PmAwaitingInvoice from './PmAwaitingInvoice'
import ServiceBillingExport from './ServiceBillingExport'
import ServiceAwaitingInvoice from './ServiceAwaitingInvoice'
import ServiceTypeFilter from './ServiceTypeFilter'
import InvoicedArchive from './InvoicedArchive'
import BillingTabs from './BillingTabs'

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string; tab?: string; serviceType?: string }>
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

  const [pmTickets, pmAwaitingInvoice, serviceTickets, serviceAwaitingInvoice, invoicedRows] = await Promise.all([
    getBillingTickets(month, year),
    getPmAwaitingInvoiceTickets(month, year),
    getServiceBillingTickets(month, year),
    getServiceAwaitingInvoiceTickets(month, year),
    // Invoiced archive narrows on billed_at (not completed_at) with the same
    // month/year param — only rendered on its own tab, so the shared param is fine.
    getInvoicedRows(month, year),
  ])

  // Inside/outside narrowing for the Service tab so a manager can work one group
  // at a time (feedback #51). Applied to BOTH service lists; PM tickets have no
  // inside/outside split. The tab badge keeps the unfiltered service total.
  const serviceType =
    params.serviceType === 'inside' || params.serviceType === 'outside'
      ? params.serviceType
      : undefined
  const filteredServiceTickets = serviceType
    ? serviceTickets.filter((t) => t.ticket_type === serviceType)
    : serviceTickets
  const filteredServiceAwaitingInvoice = serviceType
    ? serviceAwaitingInvoice.filter((t) => t.ticket_type === serviceType)
    : serviceAwaitingInvoice

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
        serviceCount={serviceTickets.length + serviceAwaitingInvoice.length}
        invoicedCount={invoicedRows.length}
        initialTab={params.tab ?? ''}
        pmContent={
          <div className="space-y-6">
            <BillingExport tickets={pmTickets} selectedMonth={month} selectedYear={year} />
            <PmAwaitingInvoice tickets={pmAwaitingInvoice} />
          </div>
        }
        serviceContent={
          <div className="space-y-6">
            <ServiceTypeFilter initial={serviceType ?? ''} />
            <ServiceBillingExport tickets={filteredServiceTickets} selectedMonth={month} selectedYear={year} />
            <ServiceAwaitingInvoice tickets={filteredServiceAwaitingInvoice} />
          </div>
        }
        invoicedContent={
          <InvoicedArchive rows={invoicedRows} selectedMonth={month} selectedYear={year} />
        }
      />
    </div>
  )
}
