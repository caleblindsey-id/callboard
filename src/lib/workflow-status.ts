/**
 * Derive WorkflowStatusCard props for a PM ticket.
 *
 * Status-dependent `enteredAt` heuristic:
 *   - `unassigned`: `created_at` (the ticket has never moved)
 *   - `completed` / `billed`: `completed_date` (the moment work wrapped)
 *   - everything else: `updated_at` as best-available proxy
 *
 * `updated_at` bumps on any field write (PO edit, location change, parts edit),
 * not just status transitions — so this is a coarse signal. We accept that
 * because adding a dedicated `status_changed_at` column is out of scope for
 * Round C, and the failure mode is "under-flag stuck tickets," not "false
 * alarm."
 */
import type { PartRequest, PmTicketRow } from '@/types/database'

/**
 * Minimal shape `deriveWorkflowProps` needs. Both `TicketWithJoins` (board
 * rows) and `TicketDetail` (single-ticket page) satisfy this — they alias the
 * technician join under different property names, so we accept both.
 */
export type WorkflowTicket = PmTicketRow & {
  customers?: { po_required: boolean } | null
  users?: { name: string } | null
  assigned_technician?: { name: string } | null
}

export interface WorkflowProps {
  state: string
  nextActor?: string
  blocker?: string
  enteredAt?: string
}

function pickEnteredAt(ticket: WorkflowTicket): string | undefined {
  switch (ticket.status) {
    case 'unassigned':
      return ticket.created_at ?? undefined
    case 'completed':
    case 'billed':
      return ticket.completed_date ?? ticket.updated_at ?? undefined
    default:
      return ticket.updated_at ?? undefined
  }
}

function pickNextActor(ticket: WorkflowTicket): string | undefined {
  const techName =
    ticket.assigned_technician?.name ?? ticket.users?.name ?? 'assigned technician'
  switch (ticket.status) {
    case 'unassigned':
      return 'Manager to assign a technician'
    case 'assigned':
      return `${techName} to start work`
    case 'in_progress':
      return `${techName} to complete the PM`
    case 'completed':
      return 'Office to bill'
    case 'billed':
      return undefined
    case 'skip_requested':
      return 'Manager to approve or reject skip'
    case 'skipped':
      return undefined
    default:
      return undefined
  }
}

function pickBlocker(ticket: WorkflowTicket): string | undefined {
  // PO needed before this ticket can be billed.
  if (
    ticket.status === 'completed' &&
    ticket.customers?.po_required &&
    !ticket.po_number
  ) {
    return 'Customer PO required before billing'
  }

  // Tech requested parts that haven't been received yet.
  const requested = (ticket.parts_requested ?? []) as PartRequest[]
  const unreceived = requested.filter((p) => p.status !== 'received')
  if (
    unreceived.length > 0 &&
    (ticket.status === 'in_progress' || ticket.status === 'assigned')
  ) {
    return unreceived.length === 1
      ? 'Waiting on 1 part'
      : `Waiting on ${unreceived.length} parts`
  }

  return undefined
}

export function deriveWorkflowProps(ticket: WorkflowTicket): WorkflowProps {
  return {
    state: ticket.status,
    nextActor: pickNextActor(ticket),
    blocker: pickBlocker(ticket),
    enteredAt: pickEnteredAt(ticket),
  }
}
