import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'

/**
 * POST /api/service-tickets/[id]/request-info
 *
 * Manager-only "Request More Info" action on an estimated ticket. Transitions
 * status back to `open` so the tech can revise, but — unlike the generic
 * PATCH-to-open reopen path — preserves the existing estimate fields
 * (estimate_parts, estimate_labor_hours, diagnosis_notes, parts_requested)
 * so the tech is editing, not starting over.
 *
 * Body: { note: string }   — pre-populated message to the tech, required.
 *
 * Uses status-guarded update so two managers racing on the same ticket
 * surface the conflict instead of silently no-op'ing.
 */

const MAX_NOTE_LENGTH = 2000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { note?: unknown }

    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json(
        { error: 'Only managers can request more info on an estimate' },
        { status: 403 }
      )
    }

    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length < 2) {
      return NextResponse.json(
        { error: 'Please describe what additional info the tech needs to provide.' },
        { status: 400 }
      )
    }
    if (note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` },
        { status: 400 }
      )
    }

    // ADMIN_ONLY: caller pre-validated as manager above; admin client bypasses
    // RLS so the status-guarded update + non-PATCH path is reliable.
    const supabase = await createAdminClient('ADMIN_ONLY')

    // Status-guarded UPDATE — concurrent transitions surface as PGRST116
    // ("no rows returned") instead of silently no-op'ing.
    const { data, error } = await supabase
      .from('service_tickets')
      .update({
        status: 'open',
        request_info_note: note,
      })
      .eq('id', id)
      .eq('status', 'estimated')
      .select('id, status, request_info_note')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Ticket is no longer awaiting approval — refresh and try again.' },
          { status: 409 }
        )
      }
      console.error('service-tickets/[id]/request-info error:', error)
      return NextResponse.json({ error: 'Failed to request more info' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('service-tickets/[id]/request-info POST error:', err)
    return NextResponse.json({ error: 'Failed to request more info' }, { status: 500 })
  }
}
