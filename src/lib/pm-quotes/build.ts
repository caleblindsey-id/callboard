import { INTERVAL_OPTIONS } from '@/lib/pm-schedule-options'

// ============================================================
// Turning a set of selected PM tickets into quote lines.
//
// Pure and shared so the create route and any later re-quote path apply the
// same rules. Everything here guards what reaches a customer document, which
// is why each failure names the offending work order instead of returning a
// generic rejection.
// ============================================================

export interface QuotableTicket {
  id: string
  work_order_number: number | null
  customer_id: number
  equipment: {
    make: string | null
    model: string | null
    serial_number: string | null
    description: string | null
  } | null
  pm_schedules: {
    billing_type: string | null
    flat_rate: number | null
    interval_months: number | null
  } | null
}

export interface QuoteLineDraft {
  pm_ticket_id: string
  work_order_number: number | null
  equipment_label: string
  equipment_description: string | null
  serial_number: string | null
  interval_months: number | null
  billing_type: string | null
  amount: number
  sort_order: number
}

export type QuoteBuildResult =
  | { ok: true; lines: QuoteLineDraft[]; subtotal: number; customerId: number }
  | { ok: false; error: string; status: number }

export function frequencyLabel(intervalMonths: number | null | undefined): string {
  const match = INTERVAL_OPTIONS.find((o) => o.value === intervalMonths)
  if (match) return match.label
  if (intervalMonths && intervalMonths > 0) return `Every ${intervalMonths} mo`
  return '—'
}

function woLabel(t: QuotableTicket): string {
  return `WO-${t.work_order_number ?? t.id.slice(0, 8)}`
}

/**
 * Validate a selection and turn it into quote lines.
 *
 * `expectedCount` is the number of ids the caller asked for. A shortfall means
 * something was soft-deleted or vanished between the board render and the
 * click, and that fails the whole request rather than quietly producing a
 * quote that is missing a machine the customer expects to see priced.
 */
export function buildQuoteLines(
  tickets: QuotableTicket[],
  expectedCount: number
): QuoteBuildResult {
  if (tickets.length === 0) {
    return { ok: false, error: 'No work orders were selected.', status: 400 }
  }

  if (tickets.length !== expectedCount) {
    return {
      ok: false,
      error: 'One or more selected work orders could not be found. Refresh the board and try again.',
      status: 409,
    }
  }

  const customerIds = new Set(tickets.map((t) => t.customer_id))
  if (customerIds.size > 1) {
    return {
      ok: false,
      error: 'All selected work orders must belong to the same customer to appear on one quote.',
      status: 400,
    }
  }

  // Only flat-rate schedules carry a quotable number. Time & materials and
  // contract schedules have none, and printing $0.00 would put a wrong figure
  // in front of a customer.
  const unquotable = tickets.filter(
    (t) =>
      t.pm_schedules?.billing_type !== 'flat_rate' ||
      !(Number(t.pm_schedules?.flat_rate) > 0)
  )
  if (unquotable.length > 0) {
    return {
      ok: false,
      error: `These work orders have no flat rate on their PM schedule and cannot be quoted: ${unquotable
        .map(woLabel)
        .join(', ')}. Set a flat rate on the schedule, or quote them manually.`,
      status: 400,
    }
  }

  const sorted = [...tickets].sort(
    (a, b) => (a.work_order_number ?? 0) - (b.work_order_number ?? 0)
  )

  const lines: QuoteLineDraft[] = sorted.map((t, idx) => ({
    pm_ticket_id: t.id,
    work_order_number: t.work_order_number,
    equipment_label:
      [t.equipment?.make, t.equipment?.model].filter(Boolean).join(' ') || 'Equipment',
    equipment_description: t.equipment?.description ?? null,
    serial_number: t.equipment?.serial_number ?? null,
    interval_months: t.pm_schedules?.interval_months ?? null,
    billing_type: t.pm_schedules?.billing_type ?? null,
    amount: Number(t.pm_schedules?.flat_rate ?? 0),
    sort_order: idx,
  }))

  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100

  return { ok: true, lines, subtotal, customerId: tickets[0].customer_id }
}
