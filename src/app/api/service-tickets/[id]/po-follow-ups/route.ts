import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { MANAGER_ROLES } from '@/types/database'
import type { PoFollowUpMethod } from '@/types/database'
import { getPoFollowUps, createPoFollowUp } from '@/lib/db/po-follow-ups'

// PO-collection follow-up log for one service ticket. Mirrors the customer-notes
// route (per-customer free text); this one is per-ticket + structured (method).
// Reads: any authenticated user. Writes: MANAGER_ROLES (office/coordinator).

const VALID_METHODS: PoFollowUpMethod[] = ['call', 'email', 'text', 'other']

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const followUps = await getPoFollowUps(id)
  return NextResponse.json(followUps)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user?.role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!MANAGER_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const method = (body as { method?: unknown }).method
  if (typeof method !== 'string' || !VALID_METHODS.includes(method as PoFollowUpMethod)) {
    return NextResponse.json(
      { error: `method must be one of: ${VALID_METHODS.join(', ')}` },
      { status: 400 }
    )
  }

  const rawNote = (body as { note?: unknown }).note
  const note = typeof rawNote === 'string' ? rawNote.trim() : ''
  if (note.length > 2000) {
    return NextResponse.json({ error: 'Note must be 2000 characters or less' }, { status: 400 })
  }

  const created = await createPoFollowUp({
    ticketId: id,
    userId: user.id,
    method: method as PoFollowUpMethod,
    note: note || null,
  })
  return NextResponse.json(created, { status: 201 })
}
