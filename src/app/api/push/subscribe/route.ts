// Save / remove a browser's Web Push subscription for the current user. Runs as
// the user's own session — RLS on push_subscriptions scopes rows to the owner.
// POST upserts (one row per endpoint); DELETE removes by endpoint.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'

type SubscribeBody = {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as SubscribeBody
  const endpoint = body.endpoint?.trim()
  const p256dh = body.keys?.p256dh?.trim()
  const auth = body.keys?.auth?.trim()
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'endpoint and keys are required' }, { status: 400 })
  }

  const supabase = await createClient()
  // Upsert on the unique endpoint: re-subscribing the same browser refreshes the
  // owner + keys rather than creating a duplicate. (A device that was previously
  // another user's would be reassigned to the current user — correct on a shared
  // device.)
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 400) ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    console.error('push/subscribe POST error:', error)
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as SubscribeBody
  const endpoint = body.endpoint?.trim()
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  const supabase = await createClient()
  // RLS already restricts to the owner; the explicit user_id eq is belt-and-suspenders.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id)

  if (error) {
    console.error('push/subscribe DELETE error:', error)
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
