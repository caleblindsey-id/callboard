import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bulkAssignServiceTechnician } from '@/lib/db/service-tickets'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { notifyTechOfBulkAssignment } from '@/lib/service-tickets/notify-assignment'

interface BulkAssignBody {
  ticketIds: string[]
  technicianId: string
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    // Managers + office staff (super_admin/manager/coordinator). Technicians
    // are excluded from MANAGER_ROLES, so they can't reassign tickets.
    if (!user?.role || !MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json() as BulkAssignBody
    const { ticketIds, technicianId } = body

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (!technicianId) {
      return NextResponse.json(
        { error: 'technicianId is required' },
        { status: 400 }
      )
    }

    // Verify the target user is an active technician — prevents bulk-assigning
    // tickets to managers, inactive users, or arbitrary UUIDs.
    const supabase = await createClient()
    const { data: tech } = await supabase
      .from('users')
      .select('id, role, active')
      .eq('id', technicianId)
      .maybeSingle()

    if (!tech || tech.role !== 'technician' || !tech.active) {
      return NextResponse.json(
        { error: 'technicianId must reference an active technician' },
        { status: 400 }
      )
    }

    const updated = await bulkAssignServiceTechnician(ticketIds, technicianId)

    // One digest email to the tech summarizing every ticket just assigned.
    // Suppress when a manager bulk-assigns to themselves. Non-fatal: the
    // reassignment already committed. Use the ids actually updated (soft-deleted
    // tickets are skipped by bulkAssignServiceTechnician).
    if (technicianId !== user.id && updated.length > 0) {
      try {
        await notifyTechOfBulkAssignment(technicianId, updated.map((t) => t.id))
      } catch (notifyErr) {
        console.error('service-tickets/bulk-assign: notification failed', notifyErr)
      }
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('service-tickets/bulk-assign error:', err)
    return NextResponse.json(
      { error: 'Failed to bulk assign technician' },
      { status: 500 }
    )
  }
}
