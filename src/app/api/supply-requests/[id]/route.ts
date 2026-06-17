import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { sendSupplyReadyNotice } from '@/lib/supply-requests/send-supply-ready-notice'
import { sendPushToUser } from '@/lib/push/send-push'
import { createNotification } from '@/lib/notifications/create-notification'
import type { SupplyRequestUpdate, SupplyRequestStatus } from '@/types/database'

// PATCH /api/supply-requests/[id] — office staff move a request through its
// lifecycle. DELETE — the owning tech cancels their own still-pending request.
//
// The proxy lets techs reach this path, so role/ownership is enforced HERE.
// (Round 2 fires the tech "ready"/"denied" notifications from the relevant cases.)

type Action = 'mark_ready' | 'mark_picked_up' | 'deny' | 'reopen'
type PatchBody = { action?: Action; reason?: unknown }

// Allowed source statuses for each action — keeps the lifecycle linear.
const ALLOWED_FROM: Record<Action, SupplyRequestStatus[]> = {
  mark_ready: ['pending'],
  mark_picked_up: ['ready'],
  deny: ['pending', 'ready'],
  reopen: ['ready', 'denied', 'picked_up'],
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!MANAGER_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json()) as PatchBody
    const action = body.action
    if (!action || !(action in ALLOWED_FROM)) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: current, error: readErr } = await supabase
      .from('supply_requests')
      .select('status, requested_by')
      .eq('id', id)
      .single()
    if (readErr || !current) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
    }
    if (!ALLOWED_FROM[action].includes(current.status as SupplyRequestStatus)) {
      return NextResponse.json(
        { error: `Can't ${action.replace('_', ' ')} a request that is ${current.status}.` },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    let update: SupplyRequestUpdate

    switch (action) {
      case 'mark_ready':
        update = { status: 'ready', ready_at: now, ready_by: user.id }
        break
      case 'mark_picked_up':
        update = { status: 'picked_up', picked_up_at: now, picked_up_by: user.id }
        break
      case 'deny': {
        const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
        if (reason.length < 2) {
          return NextResponse.json({ error: 'Enter a reason for denying the request.' }, { status: 400 })
        }
        update = { status: 'denied', denied_at: now, denied_by: user.id, denied_reason: reason.slice(0, 500) }
        break
      }
      case 'reopen':
        // Back to pending; clear lifecycle stamps so the queue/notify state resets.
        update = {
          status: 'pending',
          ready_at: null, ready_by: null, ready_notified_at: null,
          picked_up_at: null, picked_up_by: null,
          denied_at: null, denied_by: null, denied_reason: null,
        }
        break
    }

    const { error: updErr } = await supabase.from('supply_requests').update(update).eq('id', id)
    if (updErr) {
      console.error('supply-requests PATCH update error:', updErr)
      return NextResponse.json({ error: 'Failed to update request.' }, { status: 500 })
    }

    // Notify the requesting tech — best-effort, never fails the action.
    const techId = current.requested_by as string | null
    if (action === 'mark_ready') {
      try {
        await sendSupplyReadyNotice(id, supabase)
      } catch (err) {
        console.error('supply-ready notice failed:', err)
      }
    } else if (action === 'deny' && techId) {
      try {
        await sendPushToUser(techId, {
          title: 'Supply request denied',
          body: (update.denied_reason as string) ?? '',
          url: '/my-supplies',
          tag: `supply-denied-${id}`,
        })
      } catch (err) {
        console.error('supply-denied push failed:', err)
      }
      try {
        await createNotification(techId, {
          type: 'supply_request_denied',
          title: 'Supply request denied',
          body: (update.denied_reason as string) ?? null,
          url: '/my-supplies',
          entityType: 'supply_request',
          entityId: id,
        })
      } catch (err) {
        console.error('supply-denied in-app notification failed:', err)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('supply-requests PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update request.' }, { status: 500 })
  }
}

// DELETE /api/supply-requests/[id] — the owning tech cancels a pending request.
// RLS (supply_requests_tech_delete) already restricts to own + pending; we also
// allow office staff to delete on a tech's behalf.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()
    const { data: current, error: readErr } = await supabase
      .from('supply_requests')
      .select('requested_by, status')
      .eq('id', id)
      .single()
    if (readErr || !current) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
    }

    const isStaff = MANAGER_ROLES.includes(user.role)
    const isOwner = current.requested_by === user.id
    if (!isStaff && !isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (current.status !== 'pending') {
      return NextResponse.json({ error: 'Only a pending request can be cancelled.' }, { status: 409 })
    }

    const { error: delErr } = await supabase.from('supply_requests').delete().eq('id', id)
    if (delErr) {
      console.error('supply-requests DELETE error:', delErr)
      return NextResponse.json({ error: 'Failed to cancel request.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('supply-requests DELETE error:', err)
    return NextResponse.json({ error: 'Failed to cancel request.' }, { status: 500 })
  }
}
