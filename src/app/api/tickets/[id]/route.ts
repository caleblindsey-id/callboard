import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateTicket } from '@/lib/db/tickets'
import { updateAnchorMonth } from '@/lib/db/schedules'
import { getCurrentUser, isTechnician, RESET_ROLES } from '@/lib/auth'
import { PmTicketRow, TicketStatus } from '@/types/database'

// Only allow these fields to be updated via PATCH
const ALLOWED_FIELDS = [
  'assigned_technician_id',
  'status',
  'scheduled_date',
  'completed_date',
  'completion_notes',
  'hours_worked',
  'parts_used',
  'billing_amount',
  'photos',
  'po_number',
  'billing_contact_name',
  'billing_contact_email',
  'billing_contact_phone',
  'additional_parts_used',
  'additional_hours_worked',
] as const

// Techs can update status + draft completion fields (save progress)
const TECH_ALLOWED_FIELDS = [
  'status',
  'completed_date',
  'completion_notes',
  'hours_worked',
  'parts_used',
  'photos',
  'po_number',
  'billing_contact_name',
  'billing_contact_email',
  'billing_contact_phone',
  'additional_parts_used',
  'additional_hours_worked',
] as const

type AllowedUpdate = Pick<PmTicketRow, typeof ALLOWED_FIELDS[number]>

// Valid forward-only state transitions
const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  unassigned: ['assigned', 'in_progress', 'skipped'],
  assigned:   ['in_progress', 'unassigned', 'skipped'],
  in_progress: ['completed', 'assigned', 'unassigned'],
  completed:  ['billed', 'in_progress'],
  billed:     ['completed', 'in_progress', 'assigned', 'unassigned'],
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

      // Techs must use the /complete endpoint to mark tickets complete
      if (isTechnician(user.role) && nextStatus === 'completed') {
        return NextResponse.json({ error: 'Use the complete endpoint to submit ticket completion' }, { status: 403 })
      }
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
              photos: [],
              additional_parts_used: [],
              additional_hours_worked: null,
            }
          : { status: 'unassigned' as const }
        const updated = await updateTicket(id, updateData as any)
        return NextResponse.json(updated)
      }

      // Skipping with optional reschedule
      if (nextStatus === 'skipped') {
        const updated = await updateTicket(id, { status: 'skipped' })

        // If a reschedule month was provided, update the schedule's anchor
        const rescheduleMonth = Number(raw.reschedule_month)
        if (rescheduleMonth >= 1 && rescheduleMonth <= 12) {
          const supabaseForSchedule = await createClient()
          const { data: ticketData } = await supabaseForSchedule
            .from('pm_tickets')
            .select('pm_schedule_id')
            .eq('id', id)
            .single()

          if (ticketData?.pm_schedule_id) {
            await updateAnchorMonth(ticketData.pm_schedule_id, rescheduleMonth)
          }
        }

        return NextResponse.json(updated)
      }

      // Manager-only status resets (backwards transitions)
      const isReset =
        (currentStatus === 'in_progress' && (nextStatus === 'assigned' || nextStatus === 'unassigned')) ||
        (currentStatus === 'billed')
      if (isReset) {
        if (!RESET_ROLES.includes(user.role!)) {
          return NextResponse.json({ error: 'Only managers can reset ticket status' }, { status: 403 })
        }

        const clearCompletion = {
          completed_date: null,
          completion_notes: null,
          hours_worked: null,
          parts_used: null,
          billing_amount: null,
          customer_signature: null,
          customer_signature_name: null,
          photos: [],
          additional_parts_used: [],
          additional_hours_worked: null,
        }

        let updateData: Record<string, unknown> = { status: nextStatus }

        if (currentStatus === 'billed') {
          updateData.billing_exported = false
          // Keep completion data only when going back to completed
          if (nextStatus !== 'completed') {
            updateData = { ...updateData, ...clearCompletion }
          }
        } else {
          // in_progress → assigned/unassigned: clear draft data
          updateData = { ...updateData, ...clearCompletion }
        }

        // Clear technician assignment when resetting to unassigned
        if (nextStatus === 'unassigned') {
          updateData.assigned_technician_id = null
        }

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!RESET_ROLES.includes(user.role!)) {
      return NextResponse.json({ error: 'Only managers can delete tickets' }, { status: 403 })
    }

    const supabase = await createClient()

    // Fetch ticket to get photos for cleanup
    const { data: ticket, error: fetchError } = await supabase
      .from('pm_tickets')
      .select('id, photos')
      .eq('id', id)
      .single()

    if (fetchError || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Clean up photos from Supabase Storage
    const photos = (ticket.photos ?? []) as { storage_path: string }[]
    if (photos.length > 0) {
      await supabase.storage
        .from('ticket-photos')
        .remove(photos.map((p) => p.storage_path))
    }

    // Delete the ticket
    const { error: deleteError } = await supabase
      .from('pm_tickets')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(`tickets/[id] DELETE error:`, err)
    return NextResponse.json(
      { error: 'Failed to delete ticket' },
      { status: 500 }
    )
  }
}
