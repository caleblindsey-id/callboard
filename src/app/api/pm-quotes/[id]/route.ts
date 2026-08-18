import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/db/users'
import { MANAGER_ROLES } from '@/lib/auth'
import type { PmQuoteStatus, PmQuoteUpdate } from '@/types/database'
import {
  QUOTE_VALID_TRANSITIONS,
  canTransitionQuote,
  QUOTE_TOKEN_TTL_DAYS,
} from '@/lib/pm-quotes/transitions'

// ============================================================
// PATCH /api/pm-quotes/[id] — office-side status and field edits.
//
// Customer-side accept/decline does NOT come through here: that runs through
// the public token route so it can write a signature and PO without a session.
// ============================================================

const EDITABLE_FIELDS = ['notes', 'valid_until'] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const dbUser = await getUser(user.id)
    if (!dbUser || !MANAGER_ROLES.includes(dbUser.role!)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: current, error: fetchError } = await supabase
      .from('pm_quotes')
      .select('id, status')
      .eq('id', id)
      .is('deleted_at', null)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const update: PmQuoteUpdate = {}

    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined) {
        update[field] = body[field] === '' ? null : body[field]
      }
    }

    if (body.status !== undefined) {
      const next = body.status as PmQuoteStatus
      const from = current.status as PmQuoteStatus

      if (!canTransitionQuote(from, next)) {
        return NextResponse.json(
          {
            error: `A ${from} quote cannot become ${next}. Allowed from here: ${
              QUOTE_VALID_TRANSITIONS[from].join(', ') || 'nothing, this is a final state'
            }.`,
          },
          { status: 409 }
        )
      }

      update.status = next
      if (next === 'sent') {
        update.sent_at = new Date().toISOString()
        // Mint a fresh approval link every time the quote is sent, including a
        // re-send after a decline, so an old link can never resurrect a quote
        // the customer already answered. 12-char base64url, the same shape as
        // the service estimate and credit review tokens: a UUID in a
        // customer-facing URL reads as spam.
        update.approval_token = randomBytes(9).toString('base64url')
        update.approval_token_expires_at = new Date(
          Date.now() + QUOTE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
        ).toISOString()
        update.declined_at = null
        update.decline_reason = null
      }
      if (next === 'accepted') update.accepted_at = new Date().toISOString()
      if (next === 'declined') {
        update.declined_at = new Date().toISOString()
        update.decline_reason = typeof body.decline_reason === 'string' ? body.decline_reason : null
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // Compare-and-swap on the status we validated against, so two coordinators
    // acting on the same quote can't both win.
    const { data: updated, error: updateError } = await supabase
      .from('pm_quotes')
      .update(update)
      .eq('id', id)
      .eq('status', current.status)
      .is('deleted_at', null)
      .select('id, status')
      .single()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: 'This quote changed while you were working on it. Reload and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[pm-quotes] PATCH error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
