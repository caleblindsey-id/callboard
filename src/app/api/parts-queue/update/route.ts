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

// Fields the office can edit inline via the patch action. Lifecycle fields
// (status, *_at, *_by, cancelled, cancel_reason, requested_at) are intentionally
// excluded — they may only be written by the dedicated mark_ordered /
// mark_received / cancel / reopen branches so the audit trail can't be forged.
const PATCH_FIELDS: ReadonlySet<keyof PartRequest> = new Set([
  'vendor',
  'product_number',
  'vendor_item_code',
  'po_number',
])

const FIELD_MAX_LEN: Partial<Record<keyof PartRequest, number>> = {
  vendor: 200,
  product_number: 100,
  vendor_item_code: 100,
  po_number: 100,
  cancel_reason: 1000,
}

function sanitizePatchFields(input: Partial<PartRequest> | undefined): Partial<PartRequest> {
  if (!input) return {}
  const out: Partial<PartRequest> = {}
  for (const key of Object.keys(input) as Array<keyof PartRequest>) {
    if (!PATCH_FIELDS.has(key)) continue
    const raw = (input as Record<string, unknown>)[key]
    if (raw === undefined) continue
    if (raw !== null && typeof raw !== 'string') continue
    const max = FIELD_MAX_LEN[key]
    const value = typeof raw === 'string' && max ? raw.slice(0, max) : raw
    ;(out as Record<string, unknown>)[key] = value
  }
  return out
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
    const { source, ticket_id, part_index, action = 'patch', fields, reason } = body

    if (source !== 'pm' && source !== 'service') {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }
    // part_index must be a real non-negative integer. typeof catches strings;
    // Number.isInteger catches floats / NaN / Infinity that typeof allows through.
    if (!ticket_id || !Number.isInteger(part_index) || part_index < 0) {
      return NextResponse.json({ error: 'Invalid ticket_id or part_index' }, { status: 400 })
    }

    if (action === 'cancel') {
      const trimmed = reason?.trim() ?? ''
      if (!trimmed) {
        return NextResponse.json(
          { error: 'A reason is required to cancel a part request.' },
          { status: 400 }
        )
      }
      if (trimmed.length > (FIELD_MAX_LEN.cancel_reason ?? 1000)) {
        return NextResponse.json({ error: 'Cancel reason is too long.' }, { status: 400 })
      }
    }

    const safeFields = sanitizePatchFields(fields)

    const supabase = await createClient()
    const table = tableFor(source)

    // Pull updated_at for an optimistic-lock check on write — protects against
    // concurrent edits to different parts on the same ticket silently
    // overwriting each other.
    const { data: ticket, error: fetchErr } = await supabase
      .from(table)
      .select('id, parts_requested, status, updated_at')
      .eq('id', ticket_id)
      .single()

    if (fetchErr || !ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Don't allow part mutations on already-billed/completed parent tickets —
    // those rows have been exported and post-hoc edits silently corrupt records.
    if (ticket.status === 'billed' || ticket.status === 'completed') {
      return NextResponse.json(
        { error: `Cannot modify parts on a ${ticket.status} ticket. Reopen it first.` },
        { status: 409 }
      )
    }

    const parts = (ticket.parts_requested ?? []) as PartRequest[]
    if (part_index >= parts.length) {
      return NextResponse.json({ error: 'part_index out of range' }, { status: 400 })
    }

    const current = parts[part_index]
    const now = new Date().toISOString()
    let next: PartRequest = { ...current, ...safeFields }

    switch (action) {
      case 'mark_ordered': {
        // Idempotent — silently no-op on a duplicate call so retries / double-
        // clicks don't overwrite the original ordered_at / ordered_by.
        if (current.status === 'ordered') {
          return NextResponse.json({ success: true, part: current })
        }
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
        // State guard: must transition from ordered. Idempotent if already received.
        if (current.status === 'received') {
          return NextResponse.json({ success: true, part: current })
        }
        if (current.status !== 'ordered') {
          return NextResponse.json(
            { error: 'Part must be ordered before it can be received.' },
            { status: 409 }
          )
        }
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
        next = {
          ...next,
          cancelled: true,
          cancel_reason: reason!.trim(),
          cancelled_at: now,
          cancelled_by: user.id,
        }
        break
      }
      case 'reopen': {
        // Always restore to 'requested' so the part re-enters the active
        // workflow. Otherwise a part cancelled while ordered would silently
        // come back with status='ordered' and disappear from the To Order tab.
        next = {
          ...next,
          cancelled: false,
          cancel_reason: undefined,
          cancelled_at: undefined,
          cancelled_by: undefined,
          status: 'requested',
        }
        break
      }
      case 'patch':
      default:
        // Inline field edits — sanitization already restricted to PATCH_FIELDS.
        break
    }

    // Backfill requested_at for legacy rows the first time we touch them.
    if (!next.requested_at) {
      next.requested_at = current.requested_at ?? now
    }

    const updated = [...parts]
    updated[part_index] = next

    // Service tickets derive parts_received from all live (non-cancelled) parts
    // being received. PM tickets don't have a parts_received column — the
    // asymmetry is intentional.
    const updatePayload: Record<string, unknown> = { parts_requested: updated }
    if (source === 'service') {
      const live = updated.filter((p) => !p.cancelled)
      const allReceived =
        live.length > 0 && live.every((p) => p.status === 'received')
      updatePayload.parts_received = allReceived
    }

    // Optimistic-lock on updated_at. If another writer touched the row between
    // our read and write, eq(updated_at, ...) matches zero rows and the client
    // gets a 409 to retry.
    const { data: writeRows, error: writeErr } = await supabase
      .from(table)
      .update(updatePayload)
      .eq('id', ticket_id)
      .eq('updated_at', ticket.updated_at)
      .select('id')

    if (writeErr) {
      console.error('parts-queue update write error:', writeErr)
      return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
    }
    if (!writeRows || writeRows.length === 0) {
      return NextResponse.json(
        { error: 'This part was changed by someone else. Refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, part: next })
  } catch (err) {
    console.error('parts-queue/update POST error:', err)
    return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
  }
}
