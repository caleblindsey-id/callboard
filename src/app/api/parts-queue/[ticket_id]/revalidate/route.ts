import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

type Source = 'pm' | 'service'

// On-demand Synergy re-check. The validator (validate-synergy-orders.py) needs
// Python + the ERPlinked ODBC DSN + LAN access to Synergy — none of which exist
// on the hosted Vercel runtime. So instead of running it here, this route
// ENQUEUES a request in revalidation_queue (migration 098). The office
// workstation drains the queue every ~2 min (--drain-queue), runs the same
// single-ticket validation, and writes status + result back. The client polls
// GET ?queue_id= until the row flips to done/error.

const UUID_RE = /^[0-9a-f-]{36}$/i

async function requireManager() {
  const user = await getCurrentUser()
  if (!user?.role) return { error: 'Unauthorized', status: 401 as const, user: null }
  if (!MANAGER_ROLES.includes(user.role)) {
    return { error: 'Forbidden', status: 403 as const, user: null }
  }
  return { error: null, status: 200 as const, user }
}

// POST — enqueue a re-check request. Returns 202 { status: 'queued', queue_id }.
// Repeated clicks coalesce onto the existing in-flight row (partial unique index
// on (ticket_id, source) WHERE status IN ('pending','processing')).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticket_id: string }> }
) {
  const auth = await requireManager()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { ticket_id } = await params
  if (!ticket_id || !UUID_RE.test(ticket_id)) {
    return NextResponse.json({ error: 'Invalid ticket_id' }, { status: 400 })
  }

  let body: { source?: string } = {}
  try {
    body = await request.json()
  } catch {
    // empty body fine — fall through to source check
  }
  const source = body.source as Source | undefined
  if (source !== 'pm' && source !== 'service') {
    return NextResponse.json(
      { error: "Body must include source: 'pm' or 'service'" },
      { status: 400 }
    )
  }

  const supabase = await createAdminClient('ADMIN_ONLY')

  // Try to enqueue. If an in-flight request already exists for this ticket the
  // partial unique index rejects with 23505 — that's success too: return the
  // existing row so the client polls the request already in flight.
  const { data: inserted, error: insertErr } = await supabase
    .from('revalidation_queue')
    .insert({ ticket_id, source, requested_by: auth.user.id })
    .select('id')
    .single()

  if (!insertErr && inserted) {
    return NextResponse.json({ status: 'queued', queue_id: inserted.id }, { status: 202 })
  }

  if (insertErr?.code === '23505') {
    const { data: existing, error: selErr } = await supabase
      .from('revalidation_queue')
      .select('id')
      .eq('ticket_id', ticket_id)
      .eq('source', source)
      .in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!selErr && existing) {
      return NextResponse.json({ status: 'queued', queue_id: existing.id }, { status: 202 })
    }
  }

  return NextResponse.json(
    { error: 'Failed to enqueue re-check', detail: insertErr?.message },
    { status: 500 }
  )
}

// GET ?queue_id=<uuid> — poll a queued request's status. Returns
// { status, result, error }. The drain script flips status to done/error and
// stamps result (the validate_single() dict) on completion.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticket_id: string }> }
) {
  const auth = await requireManager()
  if (!auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  await params // ticket_id is implied by queue_id; consume to satisfy the signature
  const queueId = request.nextUrl.searchParams.get('queue_id')
  if (!queueId || !UUID_RE.test(queueId)) {
    return NextResponse.json({ error: 'Missing or invalid queue_id' }, { status: 400 })
  }

  const supabase = await createAdminClient('ADMIN_ONLY')
  const { data, error } = await supabase
    .from('revalidation_queue')
    .select('status, result, error')
    .eq('id', queueId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Lookup failed', detail: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }
  return NextResponse.json(data, { status: 200 })
}
