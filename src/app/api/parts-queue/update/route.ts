import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { PartRequest } from '@/types/database'

type Source = 'pm' | 'service'

type UpdateBody = {
  source: Source
  ticket_id: string
  part_index: number
  action?: 'patch' | 'mark_ordered' | 'mark_received' | 'cancel' | 'reopen'
  fields?: Partial<PartRequest>
  reason?: string
}

function tableFor(source: Source): 'pm_tickets' | 'service_tickets' {
  return source === 'pm' ? 'pm_tickets' : 'service_tickets'
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as UpdateBody
    const { source, ticket_id, part_index, action = 'patch', fields = {}, reason } = body

    if (source !== 'pm' && source !== 'service') {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }
    if (!ticket_id || typeof part_index !== 'number' || part_index < 0) {
      return NextResponse.json({ error: 'Invalid ticket_id or part_index' }, { status: 400 })
    }

    const supabase = await createClient()
    const table = tableFor(source)

    const { data: ticket, error: fetchErr } = await supabase
      .from(table)
      .select('id, parts_requested')
      .eq('id', ticket_id)
      .single()

    if (fetchErr || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const parts = (ticket.parts_requested ?? []) as PartRequest[]
    if (part_index >= parts.length) {
      return NextResponse.json({ error: 'part_index out of range' }, { status: 400 })
    }

    const current = parts[part_index]
    const now = new Date().toISOString()
    let next: PartRequest = { ...current, ...fields }

    switch (action) {
      case 'mark_ordered': {
        if (!next.product_number?.trim()) {
          return NextResponse.json(
            { error: 'Synergy item # is required to mark a part ordered.' },
            { status: 400 }
          )
        }
        if (!next.po_number?.trim()) {
          return NextResponse.json(
            { error: 'PO # is required to mark a part ordered.' },
            { status: 400 }
          )
        }
        next = {
          ...next,
          status: 'ordered',
          ordered_at: now,
          ordered_by: user.id,
        }
        break
      }
      case 'mark_received': {
        if (!next.product_number?.trim()) {
          return NextResponse.json(
            { error: 'Synergy item # is required to mark a part received.' },
            { status: 400 }
          )
        }
        next = {
          ...next,
          status: 'received',
          received_at: now,
          received_by: user.id,
        }
        break
      }
      case 'cancel': {
        if (!reason?.trim()) {
          return NextResponse.json(
            { error: 'A reason is required to cancel a part request.' },
            { status: 400 }
          )
        }
        next = {
          ...next,
          cancelled: true,
          cancel_reason: reason.trim(),
        }
        break
      }
      case 'reopen': {
        next = {
          ...next,
          cancelled: false,
          cancel_reason: undefined,
        }
        break
      }
      case 'patch':
      default:
        // Inline field edits — no status change.
        break
    }

    // Backfill requested_at for legacy rows the first time we touch them.
    if (!next.requested_at) {
      next.requested_at = current.requested_at ?? now
    }

    const updated = [...parts]
    updated[part_index] = next

    const updatePayload: Record<string, unknown> = { parts_requested: updated }

    // Service tickets derive parts_received from all-received state.
    if (source === 'service') {
      const allReceived =
        updated.length > 0 &&
        updated.every((p) => p.status === 'received' || p.cancelled)
      updatePayload.parts_received = allReceived
    }

    const { error: writeErr } = await supabase
      .from(table)
      .update(updatePayload)
      .eq('id', ticket_id)

    if (writeErr) {
      console.error('parts-queue update write error:', writeErr)
      return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
    }

    return NextResponse.json({ success: true, part: next })
  } catch (err) {
    console.error('parts-queue/update POST error:', err)
    return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
  }
}
