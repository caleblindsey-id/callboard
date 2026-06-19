// Unified, deduped estimate ledger for one piece of equipment. Pure (no imports)
// so it can be unit-tested without a DB. Two sources are merged:
//   - service_tickets: the CURRENT estimate on each ticket (any status)
//   - equipment_estimate_log: durable DECLINED snapshots (migration 117) that
//     survive a re-quote (the live ticket row would otherwise overwrite them)
// A log snapshot that merely restates a ticket which is STILL declined at the
// same amount is a duplicate and hidden; a superseded one is kept as history.

export type EstimateTicketInput = {
  id: string
  work_order_number: number | null
  estimate_amount: number | null
  status: string
  decline_reason: string | null
  estimated_at: string | null
  problem_description: string | null
}

export type EstimateLogInput = {
  id: string
  service_ticket_id: string | null
  work_order_number: number | null
  estimate_amount: number | null
  outcome: string
  decline_reason: string | null
  problem_description: string | null
  created_at: string
}

export type EquipmentEstimateHistoryRow = {
  key: string
  source: 'ticket' | 'log'
  service_ticket_id: string | null
  work_order_number: number | null
  estimate_amount: number | null
  outcome: string
  decline_reason: string | null
  description: string | null
  date: string | null
}

const cents = (x: number | null): number => Math.round((x ?? 0) * 100)

export function mergeEstimateHistory(
  tickets: EstimateTicketInput[],
  logs: EstimateLogInput[],
): EquipmentEstimateHistoryRow[] {
  // Signatures of estimates that are CURRENTLY declined on a live ticket.
  const declinedSig = new Set(
    tickets
      .filter((t) => t.status === 'declined')
      .map((t) => `${t.id}|${cents(t.estimate_amount)}`),
  )

  const ticketRows: EquipmentEstimateHistoryRow[] = tickets.map((t) => ({
    key: `t:${t.id}`,
    source: 'ticket',
    service_ticket_id: t.id,
    work_order_number: t.work_order_number,
    estimate_amount: t.estimate_amount,
    outcome: t.status,
    decline_reason: t.decline_reason,
    description: t.problem_description,
    date: t.estimated_at,
  }))

  const logRows: EquipmentEstimateHistoryRow[] = logs
    .filter(
      (l) =>
        !(
          l.service_ticket_id &&
          declinedSig.has(`${l.service_ticket_id}|${cents(l.estimate_amount)}`)
        ),
    )
    .map((l) => ({
      key: `l:${l.id}`,
      source: 'log',
      service_ticket_id: l.service_ticket_id,
      work_order_number: l.work_order_number,
      estimate_amount: l.estimate_amount,
      outcome: l.outcome,
      decline_reason: l.decline_reason,
      description: l.problem_description,
      date: l.created_at,
    }))

  return [...ticketRows, ...logRows].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : -Infinity
    const db = b.date ? new Date(b.date).getTime() : -Infinity
    return db - da // newest first; null dates (-Infinity) sort last
  })
}
