import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser, MANAGER_ROLES } from '@/lib/auth'
import { validatePhotoStoragePath } from '@/lib/security/storage-paths'
import type { TicketPhoto } from '@/types/database'

const MAX_PHOTOS_PER_LEAD = 12

type PatchBody = {
  photos?: { storage_path?: unknown }[]
}

// PATCH /api/tech-leads/[id]/photos — append photos to a lead.
//
// Called from SubmitLeadModal after the lead row has been created and the
// blobs have been uploaded to `ticket-photos/leads/{id}/{uuid}.jpg`. The
// route validates that every storage_path is correctly namespaced under
// this lead, then merges into the photos JSONB array.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    if (!user?.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as PatchBody
    if (!Array.isArray(body.photos) || body.photos.length === 0) {
      return NextResponse.json({ error: 'photos[] required.' }, { status: 400 })
    }

    const expectedPrefix = `leads/${id}/`
    const incoming: TicketPhoto[] = []
    for (const p of body.photos) {
      const check = validatePhotoStoragePath(p?.storage_path, expectedPrefix)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      incoming.push({
        storage_path: p.storage_path as string,
        uploaded_at: new Date().toISOString(),
      })
    }

    // Ownership check: only the submitter or a manager+ may attach photos.
    const supabase = await createClient()
    const { data: lead, error: fetchErr } = await supabase
      .from('tech_leads')
      .select('id, submitted_by, photos')
      .eq('id', id)
      .single()
    if (fetchErr || !lead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    }
    const isOwner = lead.submitted_by === user.id
    const isManager = MANAGER_ROLES.includes(user.role)
    if (!isOwner && !isManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const existing = (lead.photos as TicketPhoto[] | null) ?? []
    const merged = [...existing, ...incoming]
    if (merged.length > MAX_PHOTOS_PER_LEAD) {
      return NextResponse.json(
        { error: `A lead may have at most ${MAX_PHOTOS_PER_LEAD} photos.` },
        { status: 400 }
      )
    }

    // Use the admin client for the write — tech_leads RLS does not grant
    // technicians an UPDATE policy on their own row (intentional: status
    // transitions go through the manager-only /update route). The route
    // has already enforced the ownership check above.
    const admin = createAdminClient()
    const { error: writeErr } = await admin
      .from('tech_leads')
      .update({ photos: merged })
      .eq('id', id)
    if (writeErr) {
      console.error('tech-leads photos PATCH error:', writeErr)
      return NextResponse.json({ error: 'Failed to attach photos.' }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: merged.length })
  } catch (err) {
    console.error('tech-leads photos PATCH unhandled:', err)
    return NextResponse.json({ error: 'Failed to attach photos.' }, { status: 500 })
  }
}
