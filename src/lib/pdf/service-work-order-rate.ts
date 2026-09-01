import { getCustomerLaborRate } from '@/lib/db/settings'
import type { ServiceWorkOrderRow } from '@/lib/pdf/service-work-order-data'

// Informational labor rate for a service work order's breakdown — the snapshot
// taken at estimate time, falling back to the customer's current rate for the
// ticket's labor type. The authoritative figure printed as Total is
// billing_amount (server-computed), not this.
//
// Split out of service-work-order-data.ts, which stays free of DB imports so it
// can be unit-tested; this half needs a query. Shared by the per-ticket work
// order route and the batch billing export so the two can't disagree about
// which rate a reprint shows.
export async function resolveServiceLaborRate(row: ServiceWorkOrderRow): Promise<number> {
  return (
    row.estimate_labor_rate ??
    (await getCustomerLaborRate(row.customer_id, row.labor_rate_type ?? 'standard'))
  )
}
