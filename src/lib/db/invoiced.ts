import { createClient } from '@/lib/supabase/server'

// Read-only "Invoiced" archive: completed + billed work orders (service and PM),
// normalized into one shape so the billing page can show them in a single list
// after they've left the active billing queues. Filterable by bill month via
// billed_at (migration 141).

export type InvoicedRow = {
  id: string
  type: 'service' | 'pm'
  work_order_number: number | null
  customer_name: string | null
  account_number: string | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  billing_amount: number | null
  completed_at: string | null
  billed_at: string | null
}

type ServiceBilledRaw = {
  id: string
  work_order_number: number | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  billing_amount: number | null
  completed_at: string | null
  billed_at: string | null
  customers: { name: string | null; account_number: string | null } | null
}

type PmBilledRaw = {
  id: string
  work_order_number: number | null
  synergy_order_number: string | null
  synergy_invoice_number: string | null
  billing_amount: number | null
  completed_date: string | null
  billed_at: string | null
  customers: { name: string | null; account_number: string | null } | null
}

// Half-open [start, nextMonth) window on billed_at. Both columns are timestamptz.
function billedWindow(month: number, year: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`
  return { start, end }
}

export async function getInvoicedRows(month?: number, year?: number): Promise<InvoicedRow[]> {
  const supabase = await createClient()
  const narrow = month !== undefined && year !== undefined
  const win = narrow ? billedWindow(month as number, year as number) : null

  let serviceQuery = supabase
    .from('service_tickets')
    .select(`
      id, work_order_number, synergy_order_number, synergy_invoice_number,
      billing_amount, completed_at, billed_at,
      customers ( name, account_number )
    `)
    .eq('status', 'billed')
    .is('deleted_at', null)

  let pmQuery = supabase
    .from('pm_tickets')
    .select(`
      id, work_order_number, synergy_order_number, synergy_invoice_number,
      billing_amount, completed_date, billed_at,
      customers ( name, account_number )
    `)
    .eq('status', 'billed')
    .is('deleted_at', null)

  if (win) {
    serviceQuery = serviceQuery.gte('billed_at', win.start).lt('billed_at', win.end)
    pmQuery = pmQuery.gte('billed_at', win.start).lt('billed_at', win.end)
  }

  const [serviceRes, pmRes] = await Promise.all([serviceQuery, pmQuery])
  if (serviceRes.error) throw serviceRes.error
  if (pmRes.error) throw pmRes.error

  const service: InvoicedRow[] = ((serviceRes.data ?? []) as unknown as ServiceBilledRaw[]).map((t) => ({
    id: t.id,
    type: 'service',
    work_order_number: t.work_order_number,
    customer_name: t.customers?.name ?? null,
    account_number: t.customers?.account_number ?? null,
    synergy_order_number: t.synergy_order_number,
    synergy_invoice_number: t.synergy_invoice_number,
    billing_amount: t.billing_amount,
    completed_at: t.completed_at,
    billed_at: t.billed_at,
  }))

  const pm: InvoicedRow[] = ((pmRes.data ?? []) as unknown as PmBilledRaw[]).map((t) => ({
    id: t.id,
    type: 'pm',
    work_order_number: t.work_order_number,
    customer_name: t.customers?.name ?? null,
    account_number: t.customers?.account_number ?? null,
    synergy_order_number: t.synergy_order_number,
    synergy_invoice_number: t.synergy_invoice_number,
    billing_amount: t.billing_amount,
    completed_at: t.completed_date,
    billed_at: t.billed_at,
  }))

  // Newest invoice first; nulls (shouldn't happen post-backfill) sort last.
  return [...service, ...pm].sort((a, b) => {
    if (!a.billed_at && !b.billed_at) return 0
    if (!a.billed_at) return 1
    if (!b.billed_at) return -1
    return b.billed_at.localeCompare(a.billed_at)
  })
}
