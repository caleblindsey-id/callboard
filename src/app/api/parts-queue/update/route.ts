// Retry-safe (Postgres txn) — the durable write goes through
// fn_update_parts_queue (migration 074) so the parts_requested / parts_received
// / synergy_order_number patch lands atomically with an optimistic-lock guard
// on updated_at. A retry from the client converges either to a successful
// write or a 409.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { PartRequest } from '@/types/database'

type Source = 'pm' | 'service'

type UpdateBody = {
  source: Source
  ticket_id: string
  part_index: number
  action?:
    | 'patch'
    | 'mark_ordered'
    | 'mark_received'
    | 'cancel'
    | 'reopen'
    | 'set_synergy_order'
    | 'order'
    | 'pull_from_stock'
  fields?: Partial<PartRequest>
  reason?: string
  // Used only by 'set_synergy_order' — written to the parent ticket column,
  // not the parts_requested JSONB.
  synergy_order_number?: string | null
  // Justification for the 'order' triage action when we already have stock / a PO.
  triage_reason?: string
}

const SYNERGY_ORDER_MAX_LEN = 100
const TRIAGE_REASON_MAX_LEN = 1000

function tableFor(source: Source): 'pm_tickets' | 'service_tickets' {
  return source === 'pm' ? 'pm_tickets' : 'service_tickets'
}

// Fields the office can edit inline via the patch action. Lifecycle fields
// (status, *_at, *_by, cancelled, cancel_reason, requested_at) are intentionally
// excluded — they may only be written by the dedicated mark_ordered /
// mark_received / cancel / reopen branches so the audit trail can't be forged.
const PATCH_FIELDS: ReadonlySet<keyof PartRequest> = new Set([
  'vendor',
  'vendor_code',
  'product_number',
  'vendor_item_code',
  'po_number',
])

const FIELD_MAX_LEN: Partial<Record<keyof PartRequest, number>> = {
  vendor: 200,
  vendor_code: 32,
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
    // Skip the part_index check for set_synergy_order — it's a ticket-level write.
    if (!ticket_id) {
      return NextResponse.json({ error: 'Invalid ticket_id' }, { status: 400 })
    }
    if (action !== 'set_synergy_order' && (!Number.isInteger(part_index) || part_index < 0)) {
      return NextResponse.json({ error: 'Invalid part_index' }, { status: 400 })
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

    // Service tickets: estimate must be approved before parts can be triaged or
    // ordered — you don't decide sourcing on a part the customer hasn't bought.
    if (
      source === 'service' &&
      (action === 'mark_ordered' ||
        action === 'mark_received' ||
        action === 'order' ||
        action === 'pull_from_stock') &&
      (ticket.status === 'open' || ticket.status === 'estimated')
    ) {
      return NextResponse.json(
        { error: 'The estimate must be approved before parts can be reviewed or ordered.' },
        { status: 409 }
      )
    }

    // Don't allow part mutations on already-billed/completed parent tickets —
    // those rows have been exported and post-hoc edits silently corrupt records.
    if (ticket.status === 'billed' || ticket.status === 'completed') {
      return NextResponse.json(
        { error: `Cannot modify parts on a ${ticket.status} ticket. Reopen it first.` },
        { status: 409 }
      )
    }

    // Ticket-level write: parent ticket's synergy_order_number. Done before
    // the parts_requested array is touched — it has no per-part state.
    if (action === 'set_synergy_order') {
      const raw = typeof body.synergy_order_number === 'string'
        ? body.synergy_order_number.trim().slice(0, SYNERGY_ORDER_MAX_LEN)
        : null
      const value = raw === '' ? null : raw

      const { data: rpcRows, error: rpcErr } = await supabase.rpc('fn_update_parts_queue', {
        p_source: source,
        p_ticket_id: ticket_id,
        p_expected_updated_at: ticket.updated_at,
        p_update_payload: { synergy_order_number: value },
      })
      if (rpcErr) {
        if (rpcErr.code === '40001') {
          return NextResponse.json(
            { error: 'This ticket was changed by someone else. Refresh and try again.' },
            { status: 409 }
          )
        }
        console.error('parts-queue set_synergy_order RPC error:', rpcErr)
        return NextResponse.json({ error: 'Failed to update Synergy order #' }, { status: 500 })
      }
      const updatedRow = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as { synergy_order_number?: string | null } | null
      return NextResponse.json({
        success: true,
        ticket_id,
        source,
        synergy_order_number: updatedRow?.synergy_order_number ?? null,
      })
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
            { error: 'Synergy Item # is required to mark a part ordered.' },
            { status: 400 }
          )
        }
        if (!next.po_number?.trim()) {
          return NextResponse.json(
            { error: 'Synergy PO # is required to mark a part ordered.' },
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
      case 'order':
      case 'pull_from_stock': {
        // Stock-vs-order triage of a freshly requested part. Strictly from
        // 'pending_review' so a re-triage can't rewrite an already-ordered part.
        if (current.status !== 'pending_review') {
          return NextResponse.json(
            { error: 'This part is no longer awaiting review. Refresh and try again.' },
            { status: 409 }
          )
        }
        // Snapshot the stock position server-side (authoritative — don't trust a
        // client-sent number for the justification gate). Manual / non-catalog
        // parts have no product_number, so qty stays null and ordering is free.
        let qoh: number | null = null
        let qopo: number | null = null
        if (current.product_number?.trim()) {
          const { data: prod } = await supabase
            .from('products')
            .select('qty_on_hand, qty_on_po')
            .eq('number', current.product_number.trim())
            .maybeSingle()
          qoh = prod?.qty_on_hand ?? null
          qopo = prod?.qty_on_po ?? null
        }

        if (action === 'order') {
          // Justify ordering only when we actually have it on hand or inbound.
          const haveStock = (qoh ?? 0) > 0 || (qopo ?? 0) > 0
          const trimmed = body.triage_reason?.trim() ?? ''
          if (haveStock && !trimmed) {
            return NextResponse.json(
              { error: 'A justification is required to order a part we have on hand or on a PO.' },
              { status: 400 }
            )
          }
          if (trimmed.length > TRIAGE_REASON_MAX_LEN) {
            return NextResponse.json({ error: 'Justification is too long.' }, { status: 400 })
          }
          next = {
            ...next,
            status: 'requested',
            triaged_by: user.id,
            triaged_at: now,
            triage_reason: trimmed || undefined,
            qoh_at_triage: qoh,
            qopo_at_triage: qopo,
          }
        } else {
          // pull_from_stock — fulfilled in-house, no PO, no justification.
          next = {
            ...next,
            status: 'from_stock',
            triaged_by: user.id,
            triaged_at: now,
            triage_reason: undefined,
            qoh_at_triage: qoh,
            qopo_at_triage: qopo,
          }
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
      // from_stock is fulfilled in-house, same as received, for the "all parts in"
      // flag that gates service completion.
      const allReceived =
        live.length > 0 &&
        live.every((p) => p.status === 'received' || p.status === 'from_stock')
      updatePayload.parts_received = allReceived
    }

    // Optimistic-lock on updated_at via fn_update_parts_queue. If another
    // writer touched the row between our read and write, the function raises
    // OPTIMISTIC_LOCK (40001) and we return 409 for the client to retry.
    const { error: rpcErr } = await supabase.rpc('fn_update_parts_queue', {
      p_source: source,
      p_ticket_id: ticket_id,
      p_expected_updated_at: ticket.updated_at,
      p_update_payload: updatePayload,
    })

    if (rpcErr) {
      if (rpcErr.code === '40001') {
        return NextResponse.json(
          { error: 'This part was changed by someone else. Refresh and try again.' },
          { status: 409 }
        )
      }
      console.error('parts-queue update RPC error:', rpcErr)
      return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
    }

    return NextResponse.json({ success: true, part: next })
  } catch (err) {
    console.error('parts-queue/update POST error:', err)
    return NextResponse.json({ error: 'Failed to update part' }, { status: 500 })
  }
}
