import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateTicket } from '@/lib/db/tickets'
import { getCurrentUser, isTechnician } from '@/lib/auth'
import { PmTicketRow, TicketStatus } from '@/types/database'

// Only allow these fields to be updated via PATCH
const ALLOWED_FIELDS = [
  'assigned_technician_id',
  'status',
  'scheduled_date',
  'completion_notes',
  'hours_worked',
  'parts_used',
  'billing_amount',
] as const

// Techs can only update status (to start work)
const TECH_ALLOWED_FIELDS = ['status'] as const

type AllowedUpdate = Pick<PmTicketRow, typeof ALLOWED_FIELDS[number]>

// Valid forward-only state transitions
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  unassigned: ['assigned', 'in_progress', 'skipped'],
  assigned:   ['in_progress', 'unassigned', 'skipped'],
  in_progress: ['completed'],
  completed:  ['billed', 'in_progress'],
  billed:     [],
  skipped:    ['unassigned'],
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const raw = await request.json()

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Techs can only update the status field (to start work)
    const allowedFields = isTechnician(user.role)
      ? TECH_ALLOWED_FIELDS as readonly string[]
      : ALLOWED_FIELDS as readonly string[]

    const filtered = Object.fromEntries(
      Object.entries(raw).filter(([key]) => allowedFields.includes(key))
    ) as Partial<AllowedUpdate>

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: 'No recognized fields in request body' },
        { status: 400 }
      )
    }

    // If a status transition is requested, validate it against the state machine
    if (filtered.status !== undefined) {
      const supabase = await createClient()
      const { data: current, error: fetchError } = await supabase
        .from('pm_tickets')
        .select('status, assigned_technician_id')
        .eq('id', id)
        .single()

      if (fetchError || !current) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
      }

      // Techs can only modify their own assigned tickets
      if (isTechnician(user.role) && current.assigned_technician_id !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const currentStatus = current.status as TicketStatus
      const nextStatus = filtered.status as TicketStatus
      const allowed = VALID_TRANSITIONS[currentStatus] ?? []

      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          { error: `Invalid status transition: ${currentStatus} → ${nextStatus}` },
          { status: 409 }
        )
      }

      // Reopening tickets: only managers/coordinators
      const isReopen =
        (currentStatus === 'completed' && nextStatus === 'in_progress') ||
        (currentStatus === 'skipped' && nextStatus === 'unassigned')
      if (isReopen) {
        if (isTechnician(user.role)) {
          return NextResponse.json({ error: 'Only managers can reopen tickets' }, { status: 403 })
        }
        // Completed tickets need completion data cleared; skipped just needs status change
        const updateData = currentStatus === 'completed'
          ? {
              status: 'in_progress' as const,
              completed_date: null,
              completion_notes: null,
              hours_worked: null,
              parts_used: null,
              billing_amount: null,
              customer_signature: null,
              customer_signature_name: null,
            }
          : { status: 'unassigned' as const }
        const updated = await updateTicket(id, updateData as any)
        return NextResponse.json(updated)
      }
    }

    const updated = await updateTicket(id, filtered)

    return NextResponse.json(updated)
  } catch (err) {
    console.error(`tickets/[id] PATCH error:`, err)
    return NextResponse.json(
      { error: 'Failed to update ticket' },
      { status: 500 }
    )
  }
}
