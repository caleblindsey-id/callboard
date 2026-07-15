import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { PURCHASING_ROLES } from '@/types/database'

// Records the Synergy PO# (and/or vendor notes) back onto a session's vendor
// group after the agent creates the PO in Synergy from the worksheet. See
// the design spec's "PO Worksheet Output" + "Status Lifecycle" sections —
// this is the field the review->ordered and ordered->closed gates (in
// sessions/[id]/route.ts) check.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> }
) {
  try {
    const { id, code } = await params
    const vendorCode = parseInt(code, 10)
    if (!Number.isFinite(vendorCode)) {
      return NextResponse.json({ error: 'vendor code must be a number' }, { status: 400 })
    }

    const user = await getCurrentUser()
    if (!user?.role || !PURCHASING_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { synergy_po_number, notes } = body as {
      synergy_po_number?: string | null
      notes?: string | null
    }

    const update: Record<string, unknown> = {}

    if (synergy_po_number !== undefined) {
      const trimmed = typeof synergy_po_number === 'string' ? synergy_po_number.trim() : null
      if (trimmed) {
        update.synergy_po_number = trimmed
        update.po_recorded_at = new Date().toISOString()
      } else {
        update.synergy_po_number = null
        update.po_recorded_at = null
      }
    }

    if (notes !== undefined) {
      update.notes = notes
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No recognized fields in request body' }, { status: 400 })
    }

    const supabase = await createClient()

    // Fetch first — needed to give a clean 404 for an unknown session/vendor
    // pair rather than a silent no-op update (mirrors lines/[id] PATCH).
    const { data: current, error: fetchError } = await supabase
      .from('reorder_session_vendors')
      .select('id')
      .eq('session_id', id)
      .eq('vendor_code', vendorCode)
      .maybeSingle()

    if (fetchError) throw fetchError
    if (!current) {
      return NextResponse.json({ error: 'Vendor not found on this session' }, { status: 404 })
    }

    const { data: updated, error } = await supabase
      .from('reorder_session_vendors')
      .update(update)
      .eq('session_id', id)
      .eq('vendor_code', vendorCode)
      .select()
      .single()

    if (error) {
      console.error('purchasing/sessions/[id]/vendors/[code] PATCH error:', error)
      return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('purchasing/sessions/[id]/vendors/[code] PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update vendor' }, { status: 500 })
  }
}
