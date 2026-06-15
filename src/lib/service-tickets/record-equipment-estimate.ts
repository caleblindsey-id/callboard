// Writes a permanent estimate snapshot onto a piece of equipment when a service
// estimate is declined (migration 117). The snapshot is a copied row, not a view
// of the ticket — reopening a declined ticket clears decline_reason and flips it
// back to 'open', so only a copy survives the re-quote. When the same unit comes
// back later, the equipment detail page's "Past Estimates" card shows what was
// previously quoted and why it died.
//
// Writes under the service-role client (like createNotification / sendPushToUser):
// the decline caller is the customer or a manager, not a row owner, and the table
// has no client INSERT policy. Best-effort by contract: callers wrap in try/catch
// so a logging failure never undoes the decline write itself.
//
// No-op when the ticket has no linked equipment_id (inline make/model/serial
// tickets have no equipment row to attach history to — a known v1 limitation).

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export type EstimateOutcome = 'declined'

export async function recordEquipmentEstimate(
  ticketId: string,
  opts: { outcome: EstimateOutcome },
): Promise<void> {
  const admin = await createAdminClient('SERVER_ONLY')

  // Re-read the ticket so the snapshot reflects the just-committed decline
  // (decline_reason is written before this helper is called).
  const { data: ticket, error } = await admin
    .from('service_tickets')
    .select(
      'id, equipment_id, work_order_number, estimate_amount, problem_description, diagnosis_notes, decline_reason, assigned_technician_id',
    )
    .eq('id', ticketId)
    .single()

  if (error || !ticket) {
    console.error('recordEquipmentEstimate: ticket fetch failed', error)
    return
  }
  if (!ticket.equipment_id) return // inline-equipment ticket: nothing to attach to

  const { error: insertError } = await admin.from('equipment_estimate_log').insert({
    equipment_id: ticket.equipment_id,
    service_ticket_id: ticket.id,
    work_order_number: ticket.work_order_number,
    estimate_amount: ticket.estimate_amount,
    problem_description: ticket.problem_description,
    diagnosis_notes: ticket.diagnosis_notes,
    outcome: opts.outcome,
    decline_reason: ticket.decline_reason,
    technician_id: ticket.assigned_technician_id,
  })

  if (insertError) {
    console.error('recordEquipmentEstimate: insert failed', insertError)
  }
}
